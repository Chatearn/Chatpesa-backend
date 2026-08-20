const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;


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
        "GET,POST,OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
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

    try {

        console.log(
            "========== STK PUSH START =========="
        );

        console.log(
            "Request received:",
            req.body
        );


        const {
            phone,
            amount,
            reference
        } = req.body;


        /* =====================================
           VALIDATE REQUEST
        ===================================== */

        if (
            !phone ||
            !amount ||
            !reference
        ) {

            console.log(
                "Missing required fields"
            );

            return res.status(400).json({

                success: false,

                error:
                    "phone, amount and reference are required"

            });

        }


        /* =====================================
           VALIDATE PHONE
        ===================================== */

        if (!/^2547\d{8}$/.test(phone)) {

            return res.status(400).json({

                success: false,

                error:
                    "Invalid Kenyan phone number"

            });

        }


        /* =====================================
           CHECK PAYLOR VARIABLES
        ===================================== */

        if (!process.env.PAYLOR_BASE_URL) {

            console.error(
                "PAYLOR_BASE_URL is missing"
            );

            return res.status(500).json({

                success: false,

                error:
                    "PAYLOR_BASE_URL is missing"

            });

        }


        if (!process.env.PAYLOR_API_KEY) {

            console.error(
                "PAYLOR_API_KEY is missing"
            );

            return res.status(500).json({

                success: false,

                error:
                    "PAYLOR_API_KEY is missing"

            });

        }


        if (!process.env.PAYLOR_CHANNEL_ID) {

            console.error(
                "PAYLOR_CHANNEL_ID is missing"
            );

            return res.status(500).json({

                success: false,

                error:
                    "PAYLOR_CHANNEL_ID is missing"

            });

        }


        /* =====================================
           PAYLOR URL
        ===================================== */

        const url =
            `${process.env.PAYLOR_BASE_URL}` +
            `/api/v1/merchants/payments/stk-push`;


        console.log(
            "Paylor URL:",
            url
        );

        console.log(
            "Phone:",
            phone
        );

        console.log(
            "Amount:",
            amount
        );

        console.log(
            "Reference:",
            reference
        );

        console.log(
            "Channel ID:",
            process.env.PAYLOR_CHANNEL_ID
        );


        /* =====================================
           PAYLOAD
        ===================================== */

        const payload = {

            phone: phone,

            amount: amount,

            reference: reference,

            channelId:
                process.env.PAYLOR_CHANNEL_ID,

            description:
                "ChatPesa payment",

            callbackUrl:
                process.env.PAYLOR_WEBHOOK_URL

        };


        console.log(
            "Sending request to Paylor..."
        );


        /* =====================================
           SEND TO PAYLOR
        ===================================== */

        const response = await fetch(
            url,
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
                    JSON.stringify(payload)

            }
        );


        console.log(
            "Paylor HTTP status:",
            response.status
        );


        const responseText =
            await response.text();


        console.log(
            "Paylor response:",
            responseText
        );


        console.log(
            "========== STK PUSH END =========="
        );


        /* =====================================
           PARSE PAYLOR RESPONSE
        ===================================== */

        let paylorData;


        try {

            paylorData =
                JSON.parse(responseText);

        } catch (error) {

            paylorData = {

                rawResponse:
                    responseText

            };

        }


        /* =====================================
           RETURN RESPONSE TO FRONT END
        ===================================== */

        return res.status(
            response.status
        ).json({

            success:
                response.ok,

            paylorStatus:
                response.status,

            reference:
                reference,

            paylorResponse:
                paylorData

        });


    } catch (error) {

        console.error(
            "========== STK PUSH ERROR =========="
        );

        console.error(
            error
        );


        return res.status(500).json({

            success: false,

            error:
                error.message ||
                "Internal server error"

        });

    }

});


/* =========================================
   START SERVER
========================================= */

app.listen(
    PORT,
    () => {

        console.log(
            `ChatPesa server running on port ${PORT}`
        );

    }
);
