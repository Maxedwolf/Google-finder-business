const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_ADDRESS,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  return transporter;
};

const parseEmailContent = (content) => {
  const subjectMatch = content.match(/^Subject:\s*(.+)/m);
  const subject = subjectMatch ? subjectMatch[1].trim() : 'I can help grow your business online';
  const body = content.replace(/^Subject:\s*.+\n?/m, '').trim();
  return { subject, body };
};

const sendEmail = async ({ to, content, portfolioPath, portfolioName, canvaLink }) => {
  const gmail = getTransporter();
  const { subject, body } = parseEmailContent(content);

  let finalBody = body;
  if (canvaLink) {
    finalBody += `\n\n📁 View my portfolio: ${canvaLink}`;
  }

  const mailOptions = {
    from: `Web Design Abuja <${process.env.GMAIL_ADDRESS}>`,
    to,
    subject,
    text: finalBody,
    html: finalBody.replace(/\n/g, '<br>')
  };

  if (portfolioPath && fs.existsSync(portfolioPath)) {
    mailOptions.attachments = [{
      filename: portfolioName || 'portfolio.pdf',
      path: portfolioPath
    }];
  }

  const info = await gmail.sendMail(mailOptions);
  return info.messageId;
};

const verifyConnection = async () => {
  const gmail = getTransporter();
  await gmail.verify();
  return true;
};

module.exports = { sendEmail, verifyConnection };
