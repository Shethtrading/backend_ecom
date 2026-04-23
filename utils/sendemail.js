const { Resend } = require("resend");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, html, text, attachments = [] }) {
  try {
    const response = await resend.emails.send({
      from: `Sheth Trading Corporation <${process.env.SENDER_EMAIL}>`,
      to,
      subject,
      html,
      text,
      attachments, // Support for PDF + inline images
    });

    return response;
  } catch (err) {
    console.error("Resend ERROR:", err);
    console.error("Error message:", err.message);
    console.error("Error details:", err.response);
    throw err;
  }
}

module.exports = { sendEmail };
