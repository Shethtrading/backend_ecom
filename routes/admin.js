const express = require("express");
const router = express.Router();
const path = require("path");
const { enquiriesDb, updateStatus, quotation, fetchAndCategorizeData, finalizeQuotation, discard } = require("../db/admin");
const { quotation_mail } = require("../db/order");
const { getOrderAnalytics } = require("../db/analytics");
const searchData = require("../db/searchData"); // adjust path
const { Pool } = require("pg");
require("dotenv").config();  // works locally, ignored on Railway

const pool = new Pool({
    connectionString: process.env.DB_CONNECTION_STRING  
});

async function executeQuery(query, values = []) {
    const client = await pool.connect();
    try {
      const result = await client.query(query, values);
      return result.rows;
    } finally {
      client.release();
    }
  }

router.use(express.json());

router.get("/getEnquiries", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;

        const { datesort, statussort } = req.query;

        const response = await enquiriesDb(page, limit, datesort, statussort);

        res.status(200).json({ success: true, response });
    } catch (error) {
        console.error("Error in /getEnquiries", error);
        res.status(500).json({ success: false, message: "An error occurred while fetching enquiries" });
    }
});

router.post("/statusUpdate", async(req,res)=>{
    try {
        const {status, cart_id} = req.body
        const response = await updateStatus(status, cart_id);
        res.status(200).json({success:true,response})
    } catch (error) {
        console.error("error in /statusUpdate", error);
        res.status(500).json({success: false, message:"An error occured while updating status"})
    }
})

router.post("/quotation", async (req, res) => {
    try {
        const { details, items } = req.body;

        if (!details || !items || !Array.isArray(items)) {
            return res.status(400).json({
                success: false,
                message: "Invalid input format. Expected an object with 'details' and 'items'.",
            });
        }

        const { Payment, Validity, Delivery_Charges, Reply } = details;

       if (
    Payment === undefined || Payment === null ||
    Validity === undefined || Validity === null ||
    Delivery_Charges === undefined || Delivery_Charges === null ||
    Reply === undefined || Reply === null
) {
    return res.status(400).json({
        success: false,
        message: "Missing required fields in 'details' object.",
    });
}

        const cart_id = items[0]?.cart_id;

        const normalizedDeliveryCharges = Number(Delivery_Charges);
        if (!Number.isFinite(normalizedDeliveryCharges) || normalizedDeliveryCharges < 0) {
          return res.status(400).json({
            success: false,
            message: "Delivery_Charges must be a valid non-negative number.",
          });
        }

        for (const data of items) {
            const { cart_id, order_id, rate, discount, delivery } = data;

          if (!cart_id || !order_id || rate == null || delivery == null) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields in one of the items.",
                });
            }

          const normalizedRate = Number(rate);
          const normalizedDiscount = discount === "" || discount == null ? 0 : Number(discount);
          const normalizedDelivery = delivery === "" || delivery == null ? 0 : Number(delivery);

          if (!Number.isFinite(normalizedRate) || normalizedRate < 0) {
            return res.status(400).json({
              success: false,
              message: `Invalid rate for order_id ${order_id}.`,
            });
          }

          if (!Number.isFinite(normalizedDiscount) || normalizedDiscount < 0) {
            return res.status(400).json({
              success: false,
              message: `Invalid discount for order_id ${order_id}.`,
            });
          }

          if (!Number.isFinite(normalizedDelivery) || normalizedDelivery < 0) {
            return res.status(400).json({
              success: false,
              message: `Invalid delivery for order_id ${order_id}.`,
            });
          }

          await quotation(normalizedRate, normalizedDiscount, order_id, cart_id, normalizedDelivery);
        }
        
        const response = await fetchAndCategorizeData(cart_id);
        const pdf_url= await finalizeQuotation(cart_id, response.heatshrink, response.dowells, response.m3, Payment, Validity, normalizedDeliveryCharges);
        const urls = [];

        if (pdf_url?.heatshrinkDetails) urls.push(pdf_url.heatshrinkDetails);
        if (pdf_url?.dowellsDetails) urls.push(pdf_url.dowellsDetails);
        if (pdf_url?.m3Details) urls.push(pdf_url.m3Details);        
        await quotation_mail(cart_id, Reply, pdf_url.heatshrinkDetails, pdf_url.dowellsDetails,  pdf_url.m3Details, urls )
        await updateStatus("Opened", cart_id, pdf_url.heatshrinkDetails, pdf_url.dowellsDetails,  pdf_url.m3Details)
        res.status(200).json({ success: true, message: "quotation sent successfully",hs: pdf_url.heatshrinkDetails,dow: pdf_url.dowellsDetails, m3: pdf_url.m3Details});
    } catch (error) {
        console.error("Error in /quotation", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while processing the quotations.",
        });
    }
});

router.post("/discard", async (req, res) => {
    try {
        const { edit, order_id, cart_id } = req.body;

        // Determine sku and cat_no based on edit value
        const data = edit.startsWith("3M") 
            ? { sku: edit, cat_no: null } 
            : { sku: null, cat_no: edit };

        // Pass order_id, cart_id, sku, and cat_no to discard function
        const response = await discard(order_id, cart_id, data.sku, data.cat_no);

        res.status(200).json({ success: true, response });
    } catch (error) {
        console.error("Error in /discard", error);
        res.status(500).json({ success: false, message: "An error occurred while discarding item" });
    }
});

router.get("/analytics", async (req, res) => {
  try {
    const data = await getOrderAnalytics();

    res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error("Error in /analytics", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch analytics"
    });
  }
});

function mapItemToCategory(itemCode) {
  for (const category of searchData) {
    if (category.key.includes(itemCode)) {
      return category.name;
    }
  }
  return "Uncategorized";
}

router.get("/analytics/category", async (req, res) => {
  try {
    const query = `
      SELECT 
        COALESCE(sku, cat_no) AS item_code,
        COUNT(*) AS total_orders,
        SUM(quantity) AS total_quantity
      FROM order_details
      WHERE cart_id IS NOT NULL
      GROUP BY item_code;
    `;

    const result = await executeQuery(query);

    const categoryMap = {};

    for (const row of result) {
      const itemCode = row.item_code;
      const category = mapItemToCategory(itemCode);

      const orders = parseInt(row.total_orders);
      const quantity = parseInt(row.total_quantity);

      // 🧠 Initialize category if not exists
      if (!categoryMap[category]) {
        categoryMap[category] = {
          category,
          total_orders: 0,
          total_quantity: 0,
          items: [] // ✅ NEW
        };
      }

      // 🔥 Push item inside category
      categoryMap[category].items.push({
        item_code: itemCode,
        total_orders: orders,
        total_quantity: quantity,
      });

      // 🔥 Aggregate category totals
      categoryMap[category].total_orders += orders;
      categoryMap[category].total_quantity += quantity;
    }

    res.status(200).json({
      success: true,
      data: Object.values(categoryMap),
    });

  } catch (error) {
    console.error("Error in /analytics/category", error);
    res.status(500).json({
      success: false,
      message: "Failed category analytics",
    });
  }
});

router.get("/analytics/sort", async (req, res) => {
  try {
    const { order = "highest" } = req.query;

    const query = `
      SELECT 
        COALESCE(sku, cat_no) AS item_code,
        COUNT(*) AS total_orders,
        SUM(quantity) AS total_quantity
      FROM order_details
      WHERE cart_id IS NOT NULL
      GROUP BY item_code;
    `;

    const result = await executeQuery(query);

    const categoryMap = {};

    for (const row of result) {
      const itemCode = row.item_code;
      const category = mapItemToCategory(itemCode);

      const orders = parseInt(row.total_orders);
      const quantity = parseInt(row.total_quantity);

      if (!categoryMap[category]) {
        categoryMap[category] = {
          category,
          total_orders: 0,
          total_quantity: 0,
          items: []
        };
      }

      // push item
      categoryMap[category].items.push({
        item_code: itemCode,
        total_orders: orders,
        total_quantity: quantity,
      });

      // aggregate category totals
      categoryMap[category].total_orders += orders;
      categoryMap[category].total_quantity += quantity;
    }

    let categories = Object.values(categoryMap);

    // 🔥 SORT ITEMS INSIDE EACH CATEGORY
    categories.forEach((cat) => {
      cat.items.sort((a, b) => {
        return order === "lowest"
          ? a.total_orders - b.total_orders
          : b.total_orders - a.total_orders;
      });
    });

    // 🔥 SORT CATEGORIES
    categories.sort((a, b) => {
      return order === "lowest"
        ? a.total_orders - b.total_orders
        : b.total_orders - a.total_orders;
    });

    res.status(200).json({
      success: true,
      data: categories,
    });

  } catch (error) {
    console.error("Error in /analytics/sort", error);
    res.status(500).json({
      success: false,
      message: "Sorting failed",
    });
  }
});



module.exports = router;