// backend/test-smtp.js
require('dotenv').config();
const nodemailer = require('nodemailer');

async function run() {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    logger: true,
    debug: true,
  });

  try {
    // verify connection configuration
    await transporter.verify();
    console.log('SMTP connection OK');

    // try sending a test message (change to an address you control)
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,           // send to yourself for test
      subject: 'SMTP test from OTP backend',
      text: 'This is a test email from your OTP backend',
    });
    console.log('Send success:', info);
  } catch (err) {
    console.error('SMTP test failed — full error below:\n', err);
    process.exitCode = 1;
  }
}

run();
