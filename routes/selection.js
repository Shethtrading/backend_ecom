const express = require("express");
const router = express.Router();
const path = require("path");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const Fuse = require("fuse.js");
const searchData = require("../db/searchData");
const { 
  storeDataInDb, 
  userDb, 
  processOrderData, 
  getCartDetails, 
  updateCart, 
  deleteCartItem, 
  findUserByEmail,
  getContacts,
  getALLCartDetails,
  insertSubscription, 
  insertUserMessage
} = require("../db/order"); 

require("dotenv").config();  // works locally, ignored on Railway


router.use(express.json());

const generateSmallId = () => uuidv4().substring(0, 6);

const userSchema = z.object({
  name: z.string().min(1, "Name is required"), 
  email: z.string().email("Invalid email format"), 
  phone: z.string().optional() 
});

const fuse = new Fuse(searchData, {
  keys: ["key"],
  threshold: 0.4 // Adjust for fuzzy tolerance
});

router.post("/order", async (req, res) => {
  try {
    const orderDetails = req.body;
    const { quantity, name } = orderDetails;

    if ( !quantity || !name ) {
      return res.status(400).json({
        success: false,
        message: " quantity, and name are required"
      });
    }
    const uniqueId = generateSmallId();
    await storeDataInDb(orderDetails, uniqueId);
    res.status(201).json({ success: true, id: uniqueId, message: "Data stored successfully" });
  } catch (error) {
    console.error("Error in /order route:", error);
    res.status(500).json({ success: false, message: "An error occurred while storing order data" });
  }
});

router.post("/user", async (req, res) => {
  try {
    const { name, company_name, email, phone } = req.body;
    const id = await userDb(name, company_name, email, phone);
    res.status(201).json({ success: true, userId: id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors });
    }
    console.error("Error in /user route:", error);
    res.status(500).json({ success: false, message: "An error occurred while processing user data" });
  }
});

router.post("/create", async (req, res) => {
  try {
    const { email, orderIds } = req.body;
    if (!email || !Array.isArray(orderIds)) {
      return res.status(400).json({ success: false, message: "Invalid input data" });
    }
    const response = await processOrderData(orderIds, email, "New");
    res.status(201).json({ success: true, message: "Data processed successfully", cart_id : response.cartId });
  } catch (error) {
    console.error("Error in /create route:", error);
    res.status(500).json({ success: false, message: "An error occurred while processing the data" });
  }
});

router.get("/getCart/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Order ID is required" });
    }
    const itemDetails = await getCartDetails(orderId);
    if (!itemDetails) {
      return res.status(404).json({ success: false, message: "Cart details not found" });
    }
    res.status(200).json({ success: true, item: itemDetails });
  } catch (error) {
    console.error("Error in /getCart route:", error);
    res.status(500).json({ success: false, message: "An error occurred while fetching cart details" });
  }
});

router.get("/getCart", async (req, res) => {
    try {
      const { cartId } = req.body;
      if (!cartId) {
        return res.status(400).json({ success: false, message: "Cart ID is required" });
      }
      const itemDetails = await getALLCartDetails(cartId);
      if (!itemDetails) {
        return res.status(404).json({ success: false, message: "Cart details not found" });
      }
      res.status(200).json({ success: true, item: itemDetails });
    } catch (error) {
      console.error("Error in /getCart route:", error);
      res.status(500).json({ success: false, message: "An error occurred while fetching cart details" });
    }
});

router.put("/cartUpdate", async (req, res) => {
  try {
    const {  quantity, orderId } = req.body;
    if ( !quantity || !orderId) {
      return res.status(400).json({ success: false, message: "Invalid input data" });
    }
    const updateDetails = await updateCart( quantity, orderId);
    res.status(200).json({ success: true, cart: updateDetails });
  } catch (error) {
    console.error("Error in /cartUpdate route:", error);
    res.status(500).json({ success: false, message: "An error occurred while updating the cart" });
  }
});

router.delete("/itemDelete", async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Order ID is required" });
    }
    const deleteDetails = await deleteCartItem(orderId);
    if (!deleteDetails) {
      return res.status(404).json({ success: false, message: "Cart item not found" });
    }
    res.status(200).json({ success: true, cart: deleteDetails });
  } catch (error) {
    console.error("Error in /itemDelete route:", error);
    res.status(500).json({ success: false, message: "An error occurred while deleting the cart item" });
  }
});


router.post("/mailSub", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const newSubscription = await insertSubscription(email);
    res.status(201).json({ success: true, data: newSubscription });
  } catch (error) {
    console.error("Error in /mailSub route:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/userForm", async (req, res) => {
  try {
    const { name, email, phone, subject, body } = req.body;
    if (!name || !email || !body) {
      return res.status(400).json({ error: "Name, email, and body are required" });
    }

    const newMessage = await insertUserMessage(name, email, phone, subject, body);
    res.status(201).json({ success: true, data: newMessage });
  } catch (error) {
    console.error("Error in /userForm route:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/getContact", async (req, res) => {
  try {
    const result = await getContacts();
    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

router.post("/search", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ success: false, error: "Missing search query" });
    }

    const result = fuse.search(query);
    
    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "No route found" });
    }

    // Map results into desired response structure
    const results = result.map(r => ({
      name: r.item.name,
      route: r.item.route
    }));

    return res.json({
      success: true,
      results
    });

  } catch (error) {
    console.error("Search error:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});


module.exports = router;