const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

// Register Handlebars helpers
Handlebars.registerHelper('multiply', function(a, b) {
  return a * b;
});

Handlebars.registerHelper('toFixed', function (number, digits) {
  return Number(number).toFixed(digits);
});


// Register additional Handlebars helpers
Handlebars.registerHelper('add', function(a, b) {
  return a + b;
});

Handlebars.registerHelper('subtract', function(a, b) {
  return a - b;
});

// Configure AWS SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  endpoint: process.env.R2_Endpoint,
  region: "auto", // R2 always uses "auto"
  signatureVersion: "v4", // required for R2
});

async function heatshrinkpdf(quotationDetails, payment, validity, Delivery_charge,cart_id, name, company_name) {
  try {
    const orderedItems = Array.isArray(quotationDetails.items) ? quotationDetails.items : [];
    const orderedQuotationDetails = { ...quotationDetails, items: orderedItems };

    // Load HTML template
    const templatePath = path.join(__dirname, 'templates', 'invoice-template.handlebars');
    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    
    // Compile template
    const template = Handlebars.compile(templateHtml);
    
    // Calculate totals
    const totalAmount = orderedItems.reduce(
      (sum, item) => sum + item.rate * item.quantity,
      0
    );
    const delivery_amount = totalAmount + Number(Delivery_charge)
    const gstAmount = delivery_amount * 0.18;
    const grandTotal = delivery_amount + gstAmount;
    
    const logoPath = path.resolve(__dirname, "templates", "sheth_logo.jpg");
    const logoBase64 = fs.readFileSync(logoPath, "base64");
    const logoDataUri = `data:image/jpeg;base64,${logoBase64}`;
    const signPath = path.resolve(__dirname, "templates", "signature_sheth.png");
    const signBase64 = fs.readFileSync(signPath, "base64");
    const signDataUri = `data:image/jpeg;base64,${signBase64}`;
    // Render HTML with data
    const context = {
      logo: logoDataUri,
      sign: signDataUri,
      quotationDetails: orderedQuotationDetails,
      payment,
      validity,
      Delivery_charge,
      totalAmount: totalAmount,
      gstAmount: gstAmount,
      grandTotal: grandTotal,
      currentDate: new Date().toLocaleDateString(),
      name,
        company_name,
      hss: true
    };
    
    const html = template(context);
    
    // Launch headless browser
    const browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    // Set content and configure page
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.addStyleTag({
      content: `
        @page {
          size: A4;
          margin: 0;
        }
        body {
          margin: 1.5cm;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        td, th {
          padding: 8px;
          border: 1px solid #ddd;
        }
        .text-right {
          text-align: right;
        }
        .header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
        }
      `
    });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    
    await browser.close();
    
    // Upload to S3
    const randomThreeDigit = Math.floor(100 + Math.random() * 900);
    const s3Key = `3M_HS_${cart_id}_${randomThreeDigit}.pdf`;
    
    const uploadParams = {
      Bucket: process.env.R2_Bucket_Name,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    };
    
    const s3Response = await s3.upload(uploadParams).promise();
    console.log(`PDF uploaded successfully: ${s3Response.Location}`);
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${s3Key}`;
console.log("Public PDF URL:", publicUrl);
return publicUrl;

  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

async function dowellspdf(quotationDetails, payment, Delivery_charge,cart_id, name, company_name) {
  try {
    const orderedItems = Array.isArray(quotationDetails.items) ? quotationDetails.items : [];
    const orderedQuotationDetails = { ...quotationDetails, items: orderedItems };

    // Load HTML template
    const templatePath = path.join(__dirname, 'templates', 'dowells.hbs');
    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    
    // Compile template
    const template = Handlebars.compile(templateHtml);
    console.log("pdf quotaion details", orderedQuotationDetails)
    // For dowells items, calculate with discount
    const totalAmount = orderedItems.reduce(
      (sum, item) => sum + item.rate * item.quantity * (1 - (item.discount || 0) / 100),
      0
    );
    const delivery_amount = totalAmount + Number(Delivery_charge)
    const gstAmount = delivery_amount * 0.18;
    const grandTotal = delivery_amount + gstAmount;

    const logoPath = path.resolve(__dirname, "templates", "sheth_logo.jpg");
    const logoBase64 = fs.readFileSync(logoPath, "base64");
    const logoDataUri = `data:image/jpeg;base64,${logoBase64}`;
    const signPath = path.resolve(__dirname, "templates", "signature_sheth.png");
    const signBase64 = fs.readFileSync(signPath, "base64");
    const signDataUri = `data:image/jpeg;base64,${signBase64}`;
    // Render HTML with data
    const context = {
      logo: logoDataUri,
      sign: signDataUri,
      quotationDetails: orderedQuotationDetails,
      payment,
      Delivery_charge,
      validity: "7 days validity", // Default validity for dowells
      totalAmount: totalAmount.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      currentDate: new Date().toLocaleDateString(),
      name,
        company_name,
      includeDiscount: true // Flag to show discount column in template
    };
    
    const html = template(context);
    
    // Launch headless browser
    const browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    // Set content and configure page
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.addStyleTag({
      content: `
        @page {
          size: A4;
          margin: 0;
        }
        body {
          margin: 1.5cm;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        td, th {
          padding: 8px;
          border: 1px solid #ddd;
        }
        .text-right {
          text-align: right;
        }
        .header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
        }
      `
    });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    
    await browser.close();
    
    // Upload to S3
    const randomThreeDigit = Math.floor(100 + Math.random() * 900);
    const s3Key = `DOWELLS_${cart_id}_${randomThreeDigit}.pdf`;
    
    const uploadParams = {
      Bucket: process.env.R2_Bucket_Name,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    };
    
    const s3Response = await s3.upload(uploadParams).promise();
    console.log(`PDF uploaded successfully: ${s3Response.Location}`);
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${s3Key}`;
console.log("Public PDF URL:", publicUrl);
return publicUrl;

  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

async function Rest3M(quotationDetails, payment, validity, Delivery_charge, cart_id, name, company_name) {
  try {
    const orderedItems = Array.isArray(quotationDetails.items) ? quotationDetails.items : [];
    const orderedQuotationDetails = { ...quotationDetails, items: orderedItems };

    // Load HTML template
    const templatePath = path.join(__dirname, 'templates', 'invoice-template.handlebars');
    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    
    // Compile template
    const template = Handlebars.compile(templateHtml);
    
    // Calculate totals
    const totalAmount = orderedItems.reduce(
      (sum, item) => sum + item.rate * item.quantity,
      0
    );
    const delivery_amount = totalAmount + Number(Delivery_charge)
    const gstAmount = delivery_amount * 0.18;
    const grandTotal = delivery_amount + gstAmount;

const logoPath = path.resolve(__dirname, "templates", "sheth_logo.jpg");
const logoBase64 = fs.readFileSync(logoPath, "base64");
const logoDataUri = `data:image/jpeg;base64,${logoBase64}`;
const signPath = path.resolve(__dirname, "templates", "signature_sheth.png");
    const signBase64 = fs.readFileSync(signPath, "base64");
    const signDataUri = `data:image/jpeg;base64,${signBase64}`;
console.log("pdfs code ", orderedQuotationDetails)
    // Render HTML with data
    const context = {
      logo: logoDataUri,
      sign: signDataUri,
      quotationDetails: orderedQuotationDetails,
      payment,
      validity,
      Delivery_charge,
      totalAmount: totalAmount.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      currentDate: new Date().toLocaleDateString(),
       name,
        company_name,
      isRest3M: true // Flag to identify Rest3M quotation
    };
    
    const html = template(context);
    
    // Launch headless browser
    const browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    // Set content and configure page
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.addStyleTag({
      content: `
        @page {
          size: A4;
          margin: 0;
        }
        body {
          margin: 1.5cm;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        td, th {
          padding: 8px;
          border: 1px solid #ddd;
        }
        .text-right {
          text-align: right;
        }
        .header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
        }
      `
    });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    
    await browser.close();
    
    // Upload to S3 with the same naming convention as before
    const randomThreeDigit = Math.floor(100 + Math.random() * 900);
    const s3Key = `3M_MRO_${cart_id}_${randomThreeDigit}.pdf`;
    
    const uploadParams = {
      Bucket: process.env.R2_Bucket_Name,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    };
    const s3Response = await s3.upload(uploadParams).promise();
    console.log(`PDF uploaded successfully: ${s3Response.Location}`);
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${s3Key}`;
    console.log("Public PDF URL:", publicUrl);
    return publicUrl;

  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

module.exports = { heatshrinkpdf, dowellspdf, Rest3M };