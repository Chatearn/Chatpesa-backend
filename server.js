require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;

const PAYLOR_API_KEY =
    process.env.PAYLOR_API_KEY;

const PAYLOR_CHANNEL_ID =
    process.env.PAYLOR_CHANNEL_ID;

const BACKEND_URL =
    process.env.BACKEND_URL ||
    "https://chatpesa-backend.onrender.com";

const PAYLOR_WEBHOOK_SECRET =
    process.env.PAYLOR_WEBHOOK_SECRET || "";


/* =====================================================
   PAYMENT STORAGE
===================================================== */

const payments = new Map();


/* =====================================================
   COUNTRY PRICES
===================================================== */

const countryPrices = {
    China: 1,
    Canada: 450,
    Australia: 550,
    UK: 650,
    USA: 750,
    Others: 330
};


/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(cors());

app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        }
    })
);


/* =====================================================
   HOME
===================================================== */

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "ChatPesa server is running"
    });
});


/* =====================================================
   COUNTRY PRICES
===================================================== */

app.get("/country-prices", (req, res) => {
    res.json(countryPrices);
});


/* =====================================================
   STK PUSH
===================================================== */

app.post("/stk-push", async (req, res) => {

    console.log("");
    console.log("=================================");
    console.log("CHATPESA: STK REQUEST RECEIVED");
    console.log("=================================");

    try {

        const {
            phone,
            amount,
            reference,
            type,
            country
        } = req.body;


        console.log("CHATPESA DATA RECEIVED:", {
            phone,
            amount,
            reference,
            type,
            country
        });


        /* ---------------------------------------------
           BASIC VALIDATION
        --------------------------------------------- */

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required."
            });
        }

        if (!reference) {
            return res.status(400).json({
                success: false,
                message: "Payment reference is required."
            });
        }

        if (!amount) {
            return res.status(400).json({
                success: false,
                message: "Payment amount is required."
            });
        }


        /* ---------------------------------------------
           DETERMINE FINAL PAYMENT AMOUNT
        --------------------------------------------- */

        let finalAmount = Number(amount);


        /* ---------------------------------------------
           REGISTRATION PAYMENT
           ALWAYS KSH 1
        --------------------------------------------- */

        if (type === "registration") {

            finalAmount = 1;

            console.log(
                "CHATPESA: Registration payment detected."
            );

            console.log(
                "CHATPESA: Final registration amount = KSh 1"
            );
        }


        /* ---------------------------------------------
           COUNTRY UNLOCK PAYMENT
        --------------------------------------------- */

        if (type === "country_unlock") {

            if (!country) {

                return res.status(400).json({
                    success: false,
                    message: "Country is required."
                });
            }

            if (!countryPrices[country]) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid country."
                });
            }

            finalAmount =
                Number(countryPrices[country]);


            console.log(
                "CHATPESA: Country:",
                country
            );

            console.log(
                "CHATPESA: Final country amount:",
                finalAmount
            );
        }


        /* ---------------------------------------------
           FINAL AMOUNT VALIDATION
