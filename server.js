const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 10000;


/* =========================================
   CORS
========================================= */

app.use((req, res, next) => {

    res.header(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Accept"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();

});


/* =========================================
   JSON
========================================= */

app.use(express.json());


/* =========================================
   HEALTH CHECK
========================================= */

app.get("/", (req, res) => {

    res.json({
        status: "online",
        service: "ChatPesa API"
    });

});


/* =========================================
   STK PUSH
========================================= */

app.post("/stk-push", async (req, res) => {

    console.log("CHATPESA: STK request received");
    console.log("CHATPESA DATA:", req.body);

    try {

        const {
            phone,
            amount,
            reference
        } = req.body;


        /* ==============================
           VALIDATION
        ============================== */

        if (!phone) {

            return res.status(400).json({
                success: false,
                error: "Phone number is required."
            });

        }


        if (!amount) {

            return res.status(400).json({
                success: false,
                error: "Amount is required."
            });

        }


        if (!reference) {

            return res.status(400).json({
                success: false,
                error: "Reference is required."
            });

        }


        /* ==============================
           CHECK PAYLOR API KEY
        ============================== */

        if (!process.env.PAYLOR_API_KEY) {

            console.error(
                "PAYLOR_API_KEY is missing"
            );

            return res.status(500).json({
                success: false,
                error: "Paylor API key is not configured."
            });

        }


        /* ==============================
           PAYLOR REQUEST
        ============================== */

        const paylorData = {

            phone: phone,

            amount: Number(amount),

            reference: reference,

            description: "ChatPesa registration payment"

        };


        /*
        Add channelId only if it exists
        in Render environment variables.
        */

        if (process.env.PAYLOR_CHANNEL_ID) {

            paylorData.channelId =
                process.env.PAYLOR_CHANNEL_ID;

        }


        console.log(
            "CHATPESA: Sending request to Paylor"
        );


        const response = await fetch(
            "https://api.paylorke.com/api/v1/merchants/payments/stk-push",
            {

                method: "POST",

                headers: {

                    "Authorization":
                        `Bearer ${process.env.PAYLOR_API_KEY}`,

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json"

                },

                body:
                    JSON.stringify(paylorData)

            }
        );


        const text =
            await response.text();


        console.log(
            "PAYLOR HTTP STATUS:",
            response.status
        );

        console.log(
            "PAYLOR RESPONSE:",
            text
        );


        let data;

        try {

            data = JSON.parse(text);

        } catch {

            data = {
                message: text
            };

        }


        /* ==============================
           PAYLOR ERROR
        ============================== */

        if (!response.ok) {

            return res.status(
                response.status
            ).json({

                success: false,

                error:
                    data.message ||
                    data.error ||
                    "Paylor STK Push failed.",

                paylor: data

            });

        }


        /* ==============================
           SUCCESS
        ============================== */

        return res.json({

            success: true,

            message:
                "STK Push sent successfully.",

            transactionId:
                data.transactionId,

            status:
                data.status,

            paylor:
                data

        });


    } catch (error) {

        console.error(
            "CHATPESA STK ERROR:",
            error
        );


        return res.status(500).json({

            success: false,

            error:
                error.message ||
                "Unable to connect to Paylor."

        });

    }

});


/* =========================================
   START SERVER
========================================= */

app.listen(PORT, () => {

    console.log(
        `ChatPesa server running on port ${PORT}`
    );

});
