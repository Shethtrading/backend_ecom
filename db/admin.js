const { Pool } = require("pg");
const nodemailer = require("nodemailer"); 
const path = require("path");
const { heatshrinkpdf, Rest3M, dowellspdf } = require("./pdf");

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

let ensureLineOrderReady;

async function ensureLineOrderColumn() {
  if (!ensureLineOrderReady) {
    ensureLineOrderReady = (async () => {
      await executeQuery(`
        ALTER TABLE order_details
        ADD COLUMN IF NOT EXISTS line_order INTEGER;
      `);
    })();
  }

  return ensureLineOrderReady;
}

  const enquiriesDb = async (page, limit, datesort, statussort) => {
    try {
        await ensureLineOrderColumn();
        const pageNumber = parseInt(page, 10) || 1;
        const limitNumber = parseInt(limit, 10) || 10;
        const offset = (pageNumber - 1) * limitNumber;

        console.info(`[INFO] Fetching enquiries | Page: ${pageNumber}, Limit: ${limitNumber}, DateSort: ${datesort}, StatusSort: ${statussort}`);

      const values = [limitNumber, offset];
      let statusFilter = "";

      if (statussort && statussort !== "all" && statussort !== "true") {
        values.push(statussort);
        statusFilter = ` AND LOWER(cd.status) = LOWER($${values.length})`;
      }

      let cartSortClause = `
        ORDER BY 
          CASE 
            WHEN cd.status = 'New' THEN 1
            WHEN cd.status = 'Opened' THEN 2
            ELSE 3
          END,
          cd.last_update DESC
      `;

      if (datesort === "true") {
        cartSortClause = `ORDER BY cd.last_update DESC`;
      } else if (statussort === "true") {
        cartSortClause = `
          ORDER BY 
            CASE 
              WHEN cd.status = 'Opened' THEN 1
              WHEN cd.status = 'New' THEN 2
              ELSE 3
            END,
            cd.last_update DESC
        `;
      }

      const query = `
        WITH paged_carts AS (
          SELECT
            cd.id,
            cd.status,
            cd.last_update,
            cd.hs,
            cd.dow,
            cd.m3,
            cd.user_id
          FROM cart_details cd
          WHERE cd.status NOT IN ('fulfilled', 'cancelled')${statusFilter}
          ${cartSortClause}
          LIMIT $1 OFFSET $2
        )
        SELECT
          pc.id AS cart_id,
          pc.status AS cart_status,
          pc.last_update AS cart_last_update,
          pc.hs,
          pc.dow,
          pc.m3,
          ud.name AS user_name,
          ud.email AS user_email,
          ud.phone AS user_phone,
          od.order_id,
          od.sku, 
          od.cat_no,
          od.quantity,
          q.price::numeric AS quoted_price,
          qh.price::numeric AS historical_price,
          qhf.price::numeric AS family_historical_price,
          q.discount AS quoted_discount,
          q.delivery AS quoted_delivery,
          COALESCE(
            q.price::numeric,
            qh.price::numeric,
            qhf.price::numeric,
            NULLIF(REGEXP_REPLACE(dp.price::text, '[^0-9.\-]', '', 'g'), '')::numeric,
            0::numeric
          ) AS product_price
        FROM paged_carts pc
        INNER JOIN user_details ud ON pc.user_id = ud.id
        INNER JOIN order_details od ON od.cart_id = pc.id
        LEFT JOIN LATERAL (
          SELECT price, discount, delivery
          FROM quotation q
          WHERE q.order_id = od.order_id AND q.cart_id = od.cart_id
          ORDER BY q.id DESC
          LIMIT 1
        ) q ON TRUE
        LEFT JOIN LATERAL (
          SELECT q2.price
          FROM quotation q2
          INNER JOIN order_details od2
            ON od2.order_id = q2.order_id
           AND od2.cart_id = q2.cart_id
          WHERE q2.price IS NOT NULL
            AND (
              (od.sku IS NOT NULL AND od2.sku = od.sku)
              OR
              (od.cat_no IS NOT NULL AND od2.cat_no = od.cat_no)
            )
          ORDER BY q2.id DESC
          LIMIT 1
        ) qh ON TRUE
        LEFT JOIN LATERAL (
          SELECT q3.price
          FROM quotation q3
          INNER JOIN order_details od3
            ON od3.order_id = q3.order_id
           AND od3.cart_id = q3.cart_id
          WHERE q3.price IS NOT NULL
            AND od.sku LIKE '3MH%'
            AND od3.sku LIKE '3MH%'
            AND REGEXP_REPLACE(od3.sku, '[0-9]{4}$', '') = REGEXP_REPLACE(od.sku, '[0-9]{4}$', '')
          ORDER BY q3.id DESC
          LIMIT 1
        ) qhf ON TRUE
        LEFT JOIN dowells_pricelist dp ON od.cat_no = dp.cat_no
        ORDER BY pc.last_update DESC, pc.id DESC, COALESCE(od.line_order, 2147483647), od.order_id ASC;
      `;

        console.info("[INFO] Final SQL Query:\n", query);

      const rawData = await executeQuery(query, values);

        if (!rawData || rawData.length === 0) {
            console.warn("[WARN] No enquiries found with the given parameters.");
        }

        const groupedData = rawData.reduce((acc, row) => {
            const {
                cart_id,
                cart_status,
                cart_last_update,
                hs,
                dow,
                m3,
                user_name,
                user_email,
                user_phone,
                order_id,
                sku,
                cat_no,
                quantity,
                product_price,
                quoted_price,
                historical_price,
                family_historical_price,
                quoted_discount,
                quoted_delivery,
            } = row;

            let cart = acc.find((c) => c.cart_id === cart_id);

            if (!cart) {
                cart = {
                    cart_id,
                    cart_status,
                    cart_last_update,
                    hs,
                    dow,
                    m3,
                    user_name,
                    user_email,
                    user_phone,
                    orders: [],
                };
                acc.push(cart);
            }

            cart.orders.push({
                order_id,
                sku,
                cat_no,
                quantity,
              product_price: Number(product_price ?? 0),
              quoted_price: quoted_price !== null ? Number(quoted_price) : null,
              historical_price: historical_price !== null ? Number(historical_price) : null,
              family_historical_price: family_historical_price !== null ? Number(family_historical_price) : null,
              quoted_discount: quoted_discount !== null ? Number(quoted_discount) : null,
              quoted_delivery: quoted_delivery !== null ? Number(quoted_delivery) : null,
            });

            return acc;
        }, []);

        return groupedData;
    } catch (error) {
        console.error("[ERROR] Failed to fetch enquiries:", error.message, "\nStack:", error.stack);
        throw new Error("Failed to fetch enquiries data from database");
    }
};


  async function updateStatus(status, cart_id) {
    try {
      const query = `
        UPDATE cart_details
        SET status = $1
        WHERE id = $2;
      `;
      const values = [status, cart_id];
  
      const result = await executeQuery(query, values);
  
      if (result.rowCount === 0) {
        throw new Error(`No cart found with id: ${cart_id}`);
      }
      return { message: "Status updated successfully" };
    } catch (error) {
      console.error("Error updating status:", error);
      throw new Error("Error updating status");
    }
  }

  async function finalizeQuotation(cart_id, heatshrink, dowells, m3, payment, validity, Delivery_charge) {
  console.log("heatshrink", heatshrink, "dowells", dowells, "m3", m3);
  try {
    const results = {};
    let deliveryChargeUsed = false; // Track if delivery charge has been applied

    // Handle Heatshrink if not empty
    if (heatshrink && heatshrink.length > 0) {
      const charge = !deliveryChargeUsed ? Delivery_charge : 0;
      results.heatshrinkDetails = await processHeatshrink(cart_id, heatshrink, payment, validity, charge);
      deliveryChargeUsed = true;
    }

    // Handle Dowells if not empty
    if (dowells && dowells.length > 0) {
      const charge = !deliveryChargeUsed ? Delivery_charge : 0;
      results.dowellsDetails = await processDowells(cart_id, dowells, payment, charge);
      deliveryChargeUsed = true;
    }

    // Handle M3 if not empty
    if (m3 && m3.length > 0) {
      const charge = !deliveryChargeUsed ? Delivery_charge : 0;
      results.m3Details = await processM3(cart_id, m3, payment, validity, charge);
      deliveryChargeUsed = true;
    }

    return results;
  } catch (error) {
    console.error("Error in finalizeQuotation:", error);
    throw error;
  }
}

  
  async function processHeatshrink(cart_id, heatshrink, payment, validity, Delivery_charge) {
    const quotationDetails = {
      items: [],
      validity,
    };
    console.log("array of hss",heatshrink)
    for (const orderItem of heatshrink) {
      const item = await fetchhsItemDetails(cart_id, orderItem);
      if (item) {
        quotationDetails.items.push(item);
      }
    }
    const userDetailsQuery = ` 
      SELECT ud.name, ud.company_name 
FROM user_details ud
JOIN cart_details cd ON cd.user_id = ud.id  -- Ensure this matches your actual schema
WHERE cd.id = $1

    `;

    const userDetailsResult = await executeQuery(userDetailsQuery, [cart_id]);
    const userDetails = userDetailsResult[0];
    console.log(userDetails)
    const response = await heatshrinkpdf(quotationDetails, payment,validity, Delivery_charge,cart_id, userDetails.name, userDetails.company_name);
    return response;
  }
  
  async function processDowells( cart_id,dowells, payment, Delivery_charge) {
    console.log("dowells", dowells)
    const quotationDetails = {
      items: [],
    };
    for (const orderItem of dowells) {
      const item = await fetchdowellsItemDetails(cart_id, orderItem);
      if (item) {
        quotationDetails.items.push(item);
      }
    }
    const userDetailsQuery = ` 
      SELECT ud.name, ud.company_name 
FROM user_details ud
JOIN cart_details cd ON cd.user_id = ud.id  -- Ensure this matches your actual schema
WHERE cd.id = $1

    `;

    const userDetailsResult = await executeQuery(userDetailsQuery, [cart_id]);
    const userDetails = userDetailsResult[0];
    console.log(userDetails)
    console.log("final check before pdf sent ", quotationDetails)
    const response = await dowellspdf(quotationDetails, payment, Delivery_charge,cart_id,userDetails.name, userDetails.company_name);
    return response;
  }
  
  async function processM3(cart_id, m3, payment, validity, Delivery_charge) {
    const quotationDetails = {
      items: [],
      validity,
    };
    for (const orderItem of m3) {
      const item = await fetchrest3mItemDetails(cart_id, orderItem);
      if (item) {
        quotationDetails.items.push(item);
      }
    }
    const userDetailsQuery = ` 
     SELECT ud.name, ud.company_name 
FROM user_details ud
JOIN cart_details cd ON cd.user_id = ud.id  -- Ensure this matches your actual schema
WHERE cd.id = $1

    `;

    const userDetailsResult = await executeQuery(userDetailsQuery, [cart_id]);
    const userDetails = userDetailsResult[0];
    console.log(userDetails)
    const response = await Rest3M(quotationDetails, payment, validity, Delivery_charge,cart_id,userDetails.name, userDetails.company_name);
    return response;
  }

  async function fetchhsItemDetails(cart_id, orderItem) {
    try {
      const { order_id, sku } = orderItem;
      const orderDetailsQuery = `
        SELECT order_id, quantity, technology, type, voltage, core, size, cabletype, conductor 
        FROM order_details 
        WHERE cart_id = $1 AND order_id = $2
      `;
      const orderDetailsResult = await executeQuery(orderDetailsQuery, [cart_id, order_id]);
      const orderDetails = orderDetailsResult[0];
      
      if (!orderDetails || !orderDetails.quantity) {
        console.error(`Missing required fields for cart_id: ${cart_id} and sku: ${sku}`);
        return null;
      }
      console.log("orderdeatils", orderDetails)
      const quotationQuery = `
        SELECT price, delivery
        FROM quotation 
        WHERE order_id = $1 AND cart_id = $2
      `;
      const quotationResult = await executeQuery(quotationQuery, [orderDetails.order_id, cart_id]);
      console.log("quotationresult", quotationResult,orderDetails.order_id, cart_id)
      const price = quotationResult[0]?.price;
      const delivery = quotationResult[0]?.delivery;
      
      return {
        brand: "3M",
        quantity: orderDetails.quantity ?? 0,
        technology: orderDetails.technology ?? "N/A",
        type: orderDetails.type ?? "N/A",
        voltage: orderDetails.voltage ?? "N/A",
        core: orderDetails.core ?? "N/A",
        size: orderDetails.size ?? "N/A",
        cableType: orderDetails.cabletype ?? "N/A",
        conductor: orderDetails.conductor ?? "N/A",
        hsn: "85469090",
        rate: price ?? 0,
        delivery: delivery ?? 0
      };
    } catch (error) {
      console.error(`Error fetching details for cart_id: ${cart_id} and sku: ${sku}`, error);
      return null;
    }
  }
  
  async function fetchdowellsItemDetails(cart_id, orderItem) {
    try {
      const { order_id, cat_no } = orderItem;
      const dowellsDetailsQuery = `
        SELECT description, cable_od_mm, hsn_code
        FROM dowells_pricelist 
        WHERE cat_no = $1 
      `;
      const dowellsDetailsResult = await executeQuery(dowellsDetailsQuery, [cat_no]); 
      console.log("dowellsreuslt",dowellsDetailsResult)
      const dowellsDetails = dowellsDetailsResult[0];
      console.log("testting dowells pdf", dowellsDetails.description,dowellsDetails.cable_od_mm,dowellsDetails.hsn_code)
      if (!dowellsDetails) {
        console.error(`Missing required fields for cat_no: ${cat_no} `);
        return null;
      }
      
      const orderDetailsQuery = `
        SELECT order_id, quantity
        FROM order_details 
        WHERE cart_id = $1 AND order_id = $2
      `;
      const orderDetailsResult = await executeQuery(orderDetailsQuery, [cart_id, order_id]);
      console.log("dowellsorderreuslt",orderDetailsResult)
      const orderDetails = orderDetailsResult[0];
      
      if (!orderDetails || !orderDetails.quantity) {
        console.error(`Missing required fields for cart_id: ${cart_id} and cat_no: ${cat_no}`);
        return null;
      }

      const quotationQuery = `
        SELECT price,discount, delivery
        FROM quotation 
        WHERE order_id = $1 AND cart_id = $2
      `;
      const quotationResult = await executeQuery(quotationQuery, [orderDetails.order_id, cart_id]);
      console.log("quotationresult",quotationResult)
      const price = quotationResult[0]?.price;
      const delivery = quotationResult[0]?.delivery;
      const discount = quotationResult[0]?.discount;
      const catt = cat_no

      return {
        brand: `Dowell's`,
        description: dowellsDetails.description,  // ✅ Keeps correct value
        cableOd: dowellsDetails.cable_od_mm,
        cat_no: catt,
        hsn: dowellsDetails.hsn_code,             // ✅ Keeps correct value
        quantity: orderDetails.quantity ?? 0,
        rate: price ?? 0,
        discount: discount,
        delivery: delivery ?? 0
      };
      
    } catch (error) {
      console.error(`Error fetching details for cart_id: ${cart_id} and cat_no: ${cat_no}`, error);
      return null;
    }
  }
  
  async function fetchrest3mItemDetails(cart_id, orderItem) {
    try {
      const { order_id, sku } = orderItem;
      const orderDetailsQuery = `
        SELECT order_id, quantity, name
        FROM order_details 
        WHERE cart_id = $1 AND order_id = $2
      `;
      const orderDetailsResult = await executeQuery(orderDetailsQuery, [cart_id, order_id]);
      const orderDetails = orderDetailsResult[0];
  
      if (!orderDetails || !orderDetails.quantity) {
        console.error(`Missing required fields for cart_id: ${cart_id} and sku: ${sku}`);
        return null;
      }
  
      const quotationQuery = `
        SELECT price, delivery
        FROM quotation 
        WHERE order_id = $1 AND cart_id = $2
      `;
      const quotationResult = await executeQuery(quotationQuery, [orderDetails.order_id, cart_id]);
      console.log("fetchrest3m",quotationResult, quotationResult[0]?.price)
      const price = quotationResult[0]?.price;
      const delivery = quotationResult[0]?.delivery;

      return {
        brand: "3M",
        quantity: orderDetails.quantity ?? 0,
        description: orderDetails.name ?? 0,
        hsn: "85469090",
        rate: price ?? 0,
        delivery: delivery ?? 0
      };
    } catch (error) {
      console.error(`Error fetching details for cart_id: ${cart_id} and sku: ${sku}`, error);
      return null;
    }
  }

  async function fetchAndCategorizeData(cartId) {
    try {
      await ensureLineOrderColumn();
      const query = `
        SELECT order_id, sku, cat_no 
        FROM order_details 
        WHERE cart_id = $1
        ORDER BY COALESCE(line_order, 2147483647), order_id ASC;
      `;
      const values = [cartId];
  
      const result = await executeQuery(query, values);
      if (result.length === 0) {
        return { heatshrink: [], m3: [], dowells: [] };
      }
  
      const heatshrink = [];
      const m3 = [];
      const dowells = [];
  
        result.forEach(({ order_id, sku, cat_no }) => {
        // Check if `sku` is valid before calling startsWith
        if (sku) {
            if (sku.startsWith("3MHS") || sku.startsWith("3MHI") || sku.startsWith("3MHO")) {
            heatshrink.push({ order_id, sku });
            } else {
            m3.push({ order_id, sku });
            }
        }
    
        // Check if `cat_no` is valid before adding it to `dowells`
        if (cat_no) {
          dowells.push({ order_id, cat_no });
        }
    });
      return { heatshrink, m3, dowells };
    } catch (error) {
      console.error("Error fetching and categorizing data:", error);
      throw error;
    }
  }
  
  async function quotation(price, discount,order_id, cart_id, delivery) {
    try {
      const query = `
        INSERT INTO quotation (price, discount, cart_id, order_id, delivery)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `;
       const result = await executeQuery(query, [price, discount, cart_id, order_id, delivery]);
    } catch (error) {
      console.error("Error inserting quotation:", error);
      throw new Error("Error inserting quotation");
    }
  }

  async function discard(order_id, cart_id, skuu, cat_noo) {
    try {
        const fetchQuery = `
        SELECT sku, cat_no
        FROM order_details
        WHERE order_id = $1 AND cart_id = $2;
        `;
        const orderDetails = await executeQuery(fetchQuery, [order_id, cart_id]);
        const { sku: fetchedSku, cat_no: fetchedCatNo } = orderDetails[0];

        if (fetchedCatNo == null) {
          const inserField = [];
            inserField.push(fetchedSku);
            // Insert into discarded_items
            const insertDiscardQuery = `INSERT INTO discarded_items (sku, cart_id, order_id) VALUES ($1, $2, $3);`;
            await executeQuery(insertDiscardQuery, [inserField[0], cart_id, order_id]);
        } else {
            const inserField = [];
            inserField.push(fetchedCatNo);
            const insertDiscardQuery = `INSERT INTO discarded_items (sku, cart_id, order_id) VALUES ($1, $2, $3);`;
            await executeQuery(insertDiscardQuery, [inserField[0], cart_id, order_id]);
        }

        // Dynamically build update query
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (skuu !== null) {
            updateFields.push(`sku = $${paramIndex}`);
            updateValues.push(skuu);
            paramIndex++;
        }
        if (cat_noo !== null) {
            updateFields.push(`cat_no = $${paramIndex}`);
            updateValues.push(cat_noo);
            paramIndex++;
        }

        if (updateFields.length > 0) {
            const updateOrderQuery = `
                UPDATE order_details
                SET ${updateFields.join(", ")}
                WHERE order_id = $${paramIndex} AND cart_id = $${paramIndex + 1};
            `;
            console.log("Executing UPDATE:", updateValues, order_id, cart_id);
            await executeQuery(updateOrderQuery, [...updateValues, String(order_id), Number(cart_id)]);
        }

        return { message: "Operation completed successfully" };
    } catch (error) {
        console.error("Error in discard function:", error);
        throw new Error("Failed to complete discard operation");
    }
}

  module.exports = {enquiriesDb, updateStatus, quotation, discard, fetchAndCategorizeData, finalizeQuotation}