const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const fs = require("fs");
const handlebars = require("handlebars");
const axios = require("axios")
const path = require("path");
const { sendEmail } = require("../utils/sendemail");

require("dotenv").config();  // works locally, ignored on Railway

const DEFAULT_SIGNATURE_URL = "https://res.cloudinary.com/deudvpcgx/image/upload/v1776436828/3d8496fc-69d8-4beb-8589-ebe63ae17406_yqrpyk.png";

const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING
});

const transporter = nodemailer.createTransport({
  host: "smtp.hostedemail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_MAIL,
    pass: process.env.SMTP_PASSWORD,
  },
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

      await executeQuery(`
        WITH ranked AS (
          SELECT
            ctid,
            ROW_NUMBER() OVER (PARTITION BY cart_id ORDER BY order_id ASC) AS rn
          FROM order_details
          WHERE cart_id IS NOT NULL
            AND line_order IS NULL
        )
        UPDATE order_details od
        SET line_order = ranked.rn
        FROM ranked
        WHERE od.ctid = ranked.ctid;
      `);
    })();
  }

  return ensureLineOrderReady;
}

async function storeDataInDb(orderDetails, orderId) {
  // Dynamically get the column names and values from orderDetails
  const columns = Object.keys(orderDetails);
  const values = Object.values(orderDetails);

  // Add order_id to the columns and values
  columns.push('order_id');
  values.push(orderId);

  // Generate a placeholder string for values (e.g., $1, $2, $3, ...)
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");

  // Create the dynamic SQL query
  const query = `
    INSERT INTO order_details (${columns.join(", ")})
    VALUES (${placeholders})
    RETURNING *;
  `;

  try {
    const result = await executeQuery(query, values);
    console.log("Data inserted successfully:", result[0]);
    return result[0];
  } catch (error) {
    console.error("Error inserting data:", error);
    throw error;
  }
}

async function findUserByEmail(email) {
  if (!email) {
    throw new Error("Email is required to find user");
  }

  const query = "SELECT id FROM user_details WHERE LOWER(email) = LOWER($1)";
  const result = await executeQuery(query, [email.trim()]);
  console.log(result)
  if (!result || result.length == 0) {
    return null; // Return null if user is not found
  }
  return result[0].id; // Return userId if found
}

async function userDb(name, company_name, email, phone) {
  try {
    // Check if the email exists
    const checkQuery = `SELECT id FROM user_details WHERE email = $1;`;
    const checkResult = await executeQuery(checkQuery, [email]);

    if (checkResult.length > 0) {
      // Email exists, update the record
      const updateQuery = `
        UPDATE user_details 
        SET name = $1, company_name = $2, phone = $3
        WHERE email = $4
        RETURNING *;
      `;
      const updateValues = [name, company_name, phone, email];
      const updateResult = await executeQuery(updateQuery, updateValues);

      console.log("User data updated successfully:", updateResult[0]);
      return updateResult[0].id;
    } else {
      // Email does not exist, insert new record
      const insertQuery = `
        INSERT INTO user_details (name, company_name, email, phone)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      const insertValues = [name, company_name, email, phone];
      const insertResult = await executeQuery(insertQuery, insertValues);

      console.log("User data inserted successfully:", insertResult[0]);
      return insertResult[0].id;
    }
  } catch (error) {
    console.error("Error handling user data:", error);
    throw error;
  }
}


async function processOrderData(orderIds, email, status) {
  try {
    await ensureLineOrderColumn();
    console.log(orderIds, email, status)
    const userQuery = "SELECT id FROM user_details WHERE email = $1";
    const userResult = await executeQuery(userQuery, [email]);
    console.log(userResult)
    console.log(userResult[0].id)
    const userId = userResult[0].id;
    if (!userId) {
      throw new Error("User not found for the given email");
    }

    const insertCartQuery = `
      INSERT INTO cart_details (user_id, status)
      VALUES ($1, $2)
      RETURNING id`;
    const cartResult = await executeQuery(insertCartQuery, [userId, status]);
    if (!cartResult) {
      throw new Error("Failed to insert into cart_details");
    }

    const cartId = cartResult[0].id;

    for (const [index, orderId] of orderIds.entries()) {
      const orderQuery = 'SELECT sku, quantity FROM order_details WHERE order_id = $1';
      const orderResults = await executeQuery(orderQuery, [orderId]);

      if (orderResults.length > 0) {
        const updateOrderQuery = `
          UPDATE order_details
          SET cart_id = $1,
              line_order = $2
          WHERE order_id = $3`;
        await executeQuery(updateOrderQuery, [cartId, index + 1, orderId]);
      } else {
        console.warn(`Order ID ${orderId} not found in order_details`);
      }
    }
    console.log(cartId)
    return { cartId }
  } catch (error) {
    console.error("Error in processOrderData:", error);
    throw error;
  }
}

async function getCartDetails(orderId) {
  const query = 'SELECT * FROM order_details WHERE order_id = $1';
  return await executeQuery(query, [orderId]);
}

async function getALLCartDetails(cartId) {
  await ensureLineOrderColumn();
  const query = `
    SELECT *
    FROM order_details
    WHERE cart_id = $1
    ORDER BY COALESCE(line_order, 2147483647), order_id ASC
  `;
  return await executeQuery(query, [cartId]);
}

async function getContacts() {
  const query = 'SELECT * FROM message';
  return await executeQuery(query);
}

async function updateCart(quantity, order_id) {
  const query = 'UPDATE order_details SET quantity = $1 WHERE order_id = $2 RETURNING *';
  const result = await executeQuery(query, [quantity, order_id]);
  if (result && result.length > 0) {
    return result[0];
  } else {
    throw new Error("No rows returned from update query");
  }
}

async function deleteCartItem(order_id) {
  const query = 'DELETE FROM order_details WHERE order_id = $1 RETURNING *';
  const result = await executeQuery(query, [order_id]);

  if (result && result.length > 0) {
    return result[0];
  } else {
    throw new Error("No rows deleted, item may not exist");
  }
}

async function enquireMail(email, cart_id, subject) {
  console.log("[DEBUG] enquireMail() called with:", { email, cart_id, subject });

  try {
    await ensureLineOrderColumn();
    const query = `
      SELECT name, quantity
      FROM order_details
      WHERE cart_id = $1
      ORDER BY COALESCE(line_order, 2147483647), order_id ASC
    `;
    console.log("[DEBUG] Executinag query for cart_id:", cart_id);
    const result = await executeQuery(query, [cart_id]);
    console.log("[DEBUG] Query result:", result);
    console.log("[DEBUG] Number of items found:", result.length);

    if (result.length === 0) {
      console.log("[DEBUG] WARNING: No items found for cart_id:", cart_id);
    }

    // Compile template
    const templatePath = path.join(__dirname, "templates", "emailTemplate.hbs");
    console.log("[DEBUG] Template path:", templatePath);
    const templateSource = fs.readFileSync(templatePath, "utf-8");
    const template = handlebars.compile(templateSource);
    console.log("[DEBUG] Template compiled successfully");

    handlebars.registerHelper("inc", v => parseInt(v) + 1);

    const items = result.map(row => ({
      name: row.name,
      quantity: row.quantity
    }));
    console.log("[DEBUG] Items for email:", items);

    const signatureUrl = process.env.SIGNATURE_IMAGE_URL || DEFAULT_SIGNATURE_URL;
    console.log("[DEBUG] Signature URL used:", signatureUrl);

    const htmlMessage = template({ cart_id, items, signatureUrl });
    console.log("[DEBUG] HTML message generated (length):", htmlMessage.length);

    console.log("[DEBUG] Calling sendEmail()...");
    console.log("[DEBUG] sendEmail params:", { to: email, subject });

    await sendEmail({
      to: email,
      subject,
      html: htmlMessage,
      attachments: []
    });

    console.log("[DEBUG] sendEmail() completed successfully!");
    return true;

  } catch (err) {
    console.error("[DEBUG] ERROR in enquireMail:", err);
    console.error("[DEBUG] Error message:", err.message);
    console.error("[DEBUG] Error stack:", err.stack);
    throw new Error("Error sending enquiry email: " + err.message);
  }
}

async function quotation_mail(cart_id, reply, hs, dow, m3, urls) {
  try {
    await executeQuery(`
      UPDATE cart_details 
      SET hs = $2, dow = $3, m3 = $4 
      WHERE id = $1`,
      [cart_id, hs, dow, m3]
    );

    const cartDetails = await executeQuery(
      "SELECT user_id FROM cart_details WHERE id = $1",
      [cart_id]
    );
    if (!cartDetails[0]) throw new Error("Cart not found");

    const user_id = cartDetails[0].user_id;

    const userProfile = await executeQuery(
      "SELECT email, name FROM user_details WHERE id = $1",
      [user_id]
    );
    if (!userProfile[0]) throw new Error("User not found");

    const { email, name } = userProfile[0];

    // Load PDFs
    const pdfAttachments = await Promise.all(
      urls.map(async (url) => {
        const response = await axios.get(url, { responseType: "arraybuffer" });
        return {
          filename: `Quotation_${url.split("/").pop()}.pdf`,
          content: Buffer.from(response.data).toString("base64"),
        };
      })
    );

    const signatureUrl = process.env.SIGNATURE_IMAGE_URL || DEFAULT_SIGNATURE_URL;

    // Compile HTML email
    const templatePath = path.join(__dirname, "templates", "quotation.hbs");
    const templateSource = fs.readFileSync(templatePath, "utf-8");
    const template = handlebars.compile(templateSource);

    const htmlMessage = template({
      name,
      cart_id,
      reply,
      signatureUrl
    });

    await sendEmail({
      to: email,
      subject: "Here is your Quotation",
      html: htmlMessage,
      attachments: pdfAttachments
    });

    return true;

  } catch (err) {
    console.error("Error sending quotation email:", err);
    return false;
  }
}


const insertSubscription = async (email) => {
  const query = "INSERT INTO sub (email) VALUES ($1) RETURNING *";
  return await executeQuery(query, [email]);
};

// Function to insert user form data into the 'message' table
const insertUserMessage = async (name, email, phone, subject, body) => {
  const query = `
    INSERT INTO message (name, email, phone, subject, body)
    VALUES ($1, $2, $3, $4, $5) RETURNING *`;
  return await executeQuery(query, [name, email, phone, subject, body]);
};

module.exports = { getContacts, insertSubscription, insertUserMessage, quotation_mail, getALLCartDetails, storeDataInDb, userDb, findUserByEmail, processOrderData, getCartDetails, updateCart, deleteCartItem, enquireMail };