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
    console.error("Error in /smtp-test route:", err);
    res.status(500).send(err.message);
  }
});

// ENQUIRY MAIL
router.post("/enquiryMail", async (req, res) => {
  try {
    const { email, cart_id } = req.body;

    if (!email || !cart_id) {
      return res.status(400).json({
        success: false,
        message: "Email and cart_id are required.",
      });
    }

    const response = await enquireMail(
      email,
      cart_id,
      "We have received your order enquiry"
    );

    if (response) {
      return res.status(200).json({
        success: true,
        message: "Enquiry email sent successfully.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to send enquiry email.",
    });

  } catch (error) {
    console.error("Error in /enquiryMail route:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error.",
      error: error.message,
    });
  }
});

module.exports = router;
