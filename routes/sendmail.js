const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const handlebars = require("handlebars");
const axios = require("axios");

const { sendEmail } = require("../utils/sendemail");
const { enquireMail, quotation_mail } = require("../db/order");

require("dotenv").config();
router.use(express.json());

// TEST EMAIL
router.get("/smtp-test", async (req, res) => {
  try {
    await sendEmail({
      to: process.env.SENDER_EMAIL,
      subject: "Railway Resend Test",
      text: "Resend email working!",
    });

    res.send("Email sent using Resend!");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ENQUIRY MAIL
router.post("/enquiryMail", async (req, res) => {
  console.log("========================================");
  console.log("[DEBUG] /enquiryMail endpoint called");
  console.log("[DEBUG] Request body:", req.body);
  console.log("[DEBUG] Timestamp:", new Date().toISOString());
  
  try {
    const { email, cart_id } = req.body;

    console.log("[DEBUG] Extracted email:", email);
    console.log("[DEBUG] Extracted cart_id:", cart_id);
    console.log("[DEBUG] SENDER_EMAIL from env:", process.env.SENDER_EMAIL);
    console.log("[DEBUG] RESEND_API_KEY exists:", !!process.env.RESEND_API_KEY);

    if (!email || !cart_id) {
      console.log("[DEBUG] Validation FAILED - Missing email or cart_id");
      return res.status(400).json({
        success: false,
        message: "Email and cart_id are required.",
      });
    }

    console.log("[DEBUG] Validation PASSED - Calling enquireMail()...");
    
    const response = await enquireMail(
      email,
      cart_id,
      "We have received your order enquiry"
    );

    console.log("[DEBUG] enquireMail() response:", response);

    if (response) {
      console.log("[DEBUG] Email sent SUCCESSFULLY");
      console.log("========================================");
      return res.status(200).json({
        success: true,
        message: "Enquiry email sent successfully.",
      });
    }

    console.log("[DEBUG] enquireMail() returned falsy response");
    console.log("========================================");
    return res.status(500).json({
      success: false,
      message: "Failed to send enquiry email.",
    });

  } catch (error) {
    console.error("[DEBUG] ERROR in /enquiryMail:", error);
    console.error("[DEBUG] Error stack:", error.stack);
    console.log("========================================");
    res.status(500).json({
      success: false,
      message: "Internal Server Error.",
      error: error.message,
    });
  }
});

module.exports = router;
