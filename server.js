const express = require("express");
const dotenv = require("dotenv");
const crypto = require("crypto");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 10000;


// =====================================================
// CORS
// =====================================================

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
        "Content-Type, Accept, Authorization, X-Webhook-Signature, X-Webhook-Event"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();

});


// =====================================================
// JSON PARSER
// KEEP RAW BODY FOR PAYLOR WEBHOOK SIGNATURE
// =====================================================

app.use(
    express.json({
        verify: (req, res, buffer) => {
            req.rawBody = buffer;
        }
    })
);


// =====================================================
// PAYMENT STORAGE
// =====================================================

const payments = new Map();


// =====================================================
// COUNTRY UNLOCK PRICES
// =====================================================

const countryPrices = {

    China: 2,

    Canada: 3,

    Australia: 4,

    UK: 5,

    USA: 6,

    Others: 1

};


// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {

    res.json({

        status: "online",

        service: "ChatPesa API",

        message: "ChatPesa backend is running."

    });

});


// =====================================================
// STK PUSH
// =====================================================

app.post("/stk-push", async (req, res) => {

    console.log("");
    console.log("=================================");
    console.log("CHATPESA STK REQUEST");
    console.log("=================================");

    console.log(
        "REQUEST:",
        JSON.stringify(req.body, null, 2)
    );


    try {

        const {
            phone,
            amount,
            reference,
            type,
            country
        } = req.body;


        // =================================================
        // VALIDATE PHONE
        // =================================================

        if (!phone) {

            return res.status(400).json({

                success: false,

                error: "Phone number is required."

            });

        }


        const cleanPhone =
            String(phone).replace(/\s+/g, "");


        if (
            !/^2547\d{8}$/.test(cleanPhone)
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Use a valid M-PESA number in the format 2547XXXXXXXX."

            });

        }


        // =================================================
        // VALIDATE REFERENCE
        // =================================================

        if (!reference) {

            return res.status(400).json({

                success: false,

                error: "Reference is required."

            });

        }


        // =================================================
        // PAYMENT TYPE
        // =================================================

        const paymentType =
            type || "registration";


        // =================================================
        // AMOUNT
        // =================================================

        const numericAmount =
            Number(amount);


        if (
            !Number.isFinite(numericAmount) ||
            numericAmount <= 0
        ) {

            return res.status(400).json({

                success: false,

                error: "Invalid payment amount."

            });

        }


        // =================================================
        // REGISTRATION PAYMENT
        // =================================================

        if (
            paymentType === "registration"
        ) {

            if (
                numericAmount !== 1
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Registration payment must be KSh 1."

                });

            }

        }


        // =================================================
        // COUNTRY UNLOCK
        // =================================================

        else if (
            paymentType === "country_unlock"
        ) {

            if (!country) {

                return res.status(400).json({

                    success: false,

                    error: "Country is required."

                });

            }


            if (
                !Object.prototype.hasOwnProperty.call(
                    countryPrices,
                    country
                )
            ) {

                return res.status(400).json({

                    success: false,

                    error: "Invalid country."

                });

            }


            // IMPORTANT:
            // The server controls the country price.

            const correctAmount =
                countryPrices[country];


            if (
                numericAmount !==
                correctAmount
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        `The unlock fee for ${country} is KSh ${correctAmount}.`

                });

            }

        }


        // =================================================
        // INVALID PAYMENT TYPE
        // =================================================

        else {

            return res.status(400).json({

                success: false,

                error: "Invalid payment type."

            });

        }


        // =================================================
        // PAYLOR API KEY
        // =================================================

        if (
            !process.env.PAYLOR_API_KEY
        ) {

            console.error(
                "PAYLOR_API_KEY is missing."
            );

            return res.status(500).json({

                success: false,

                error:
                    "Paylor API key is not configured on the server."

            });

        }


        // =================================================
        // BACKEND URL
        // =================================================

        const backendUrl =
            process.env.BACKEND_URL ||
            "https://chatpesa-backend.onrender.com";


        const callbackUrl =
            `${backendUrl}/paylor-callback`;


        console.log(
            "CALLBACK URL:",
            callbackUrl
        );


        // =================================================
        // SAVE PENDING PAYMENT
        // =================================================

        payments.set(reference, {

            status: "PENDING",

            phone: cleanPhone,

            amount: numericAmount,

            reference: reference,

            type: paymentType,

            country: country || null,

            createdAt:
                new Date().toISOString()

        });


        // =================================================
        // DESCRIPTION
        // =================================================

        let description =
            "ChatPesa registration payment";


        if (
            paymentType ===
            "country_unlock"
        ) {

            description =
                `ChatPesa ${country} country unlock`;

        }


        // =================================================
        // PAYLOR REQUEST
        // =================================================

        const paylorData = {

            phone: cleanPhone,

            amount: numericAmount,

            reference: reference,

            description: description,

            callbackUrl: callbackUrl

        };


        // =================================================
        // OPTIONAL CHANNEL
        // =================================================

        if (
            process.env.PAYLOR_CHANNEL_ID
        ) {

            paylorData.channelId =
                process.env.PAYLOR_CHANNEL_ID;

        }


        console.log(
            "PAYLOR REQUEST:",
            JSON.stringify(
                paylorData,
                null,
                2
            )
        );


        // =================================================
        // SEND STK PUSH TO PAYLOR
        // =================================================

        const response =
            await fetch(
                "https://api.paylorke.com/api/v1/merchants/payments/stk-push",
                {

                    method: "POST",

                    headers: {

                        "Authorization":
                            `Bearer ${process.env.PAYLOR_API_KEY}`,

                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json",

                        // Prevent duplicate payment
                        // creation on retries.

                        "Idempotency-Key":
                            reference

                    },

                    body:
                        JSON.stringify(
                            paylorData
                        )

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

            data =
                JSON.parse(text);

        } catch {

            data = {

                message: text

            };

        }


        // =================================================
        // PAYLOR REQUEST FAILED
        // =================================================

        if (!response.ok) {

            const existing =
                payments.get(reference) || {};


            payments.set(reference, {

                ...existing,

                status: "FAILED",

                error:
                    data.message ||
                    data.error ||
                    "Paylor STK Push failed.",

                paylorResponse:
                    data,

                updatedAt:
                    new Date().toISOString()

            });


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


        // =================================================
        // STK SENT
        // =================================================

        const existing =
            payments.get(reference) || {};


        payments.set(reference, {

            ...existing,

            status: "PENDING",

            transactionId:
                data.transactionId ||
                null,

            paylorStatus:
                data.status ||
                null,

            paylorResponse:
                data,

            updatedAt:
                new Date().toISOString()

        });


        return res.json({

            success: true,

            message:
                "STK Push sent successfully.",

            reference: reference,

            transactionId:
                data.transactionId ||
                null,

            status:
                data.status ||
                "SENT"

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


// =====================================================
// PAYLOR WEBHOOK
// =====================================================

app.post(
    "/paylor-callback",
    (req, res) => {

        console.log("");
        console.log("=================================");
        console.log("PAYLOR WEBHOOK RECEIVED");
        console.log("=================================");


        try {

            // =================================================
            // VERIFY WEBHOOK SECRET
            // =================================================

            const signature =
                req.headers[
                    "x-webhook-signature"
                ];


            const secret =
                process.env.PAYLOR_WEBHOOK_SECRET;


            if (!secret) {

                console.error(
                    "PAYLOR_WEBHOOK_SECRET is missing."
                );

                return res.status(500).json({

                    received: false,

                    error:
                        "Webhook secret is not configured."

                });

            }


            if (!req.rawBody) {

                console.error(
                    "Raw webhook body is missing."
                );

                return res.status(400).json({

                    received: false,

                    error:
                        "Raw webhook body is missing."

                });

            }


            const expectedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        secret
                    )
                    .update(req.rawBody)
                    .digest("hex");


            // Timing-safe comparison

            const signatureBuffer =
                Buffer.from(
                    String(signature || "")
                );

            const expectedBuffer =
                Buffer.from(
                    expectedSignature
                );


            if (
                signatureBuffer.length !==
                expectedBuffer.length
            ) {

                console.error(
                    "Invalid Paylor webhook signature."
                );

                return res.status(401).json({

                    received: false,

                    error:
                        "Invalid webhook signature."

                });

            }


            if (
                !crypto.timingSafeEqual(
                    signatureBuffer,
                    expectedBuffer
                )
            ) {

                console.error(
                    "Invalid Paylor webhook signature."
                );

                return res.status(401).json({

                    received: false,

                    error:
                        "Invalid webhook signature."

                });

            }


            console.log(
                "Webhook signature verified."
            );


            // =================================================
            // READ PAYLOR EVENT
            // =================================================

            const body =
                req.body || {};


            const event =
                body.event ||
                req.headers[
                    "x-webhook-event"
                ];


            const transaction =
                body.transaction ||
                null;


            console.log(
                "PAYLOR EVENT:",
                event
            );


            console.log(
                "PAYLOR TRANSACTION:",
                JSON.stringify(
                    transaction,
                    null,
                    2
                )
            );


            // =================================================
            // TRANSACTION REFERENCE
            // =================================================

            const reference =
                transaction?.reference ||
                body.reference ||
                body.external_reference ||
                body.externalReference;


            if (!reference) {

                console.error(
                    "Payment reference not found in webhook."
                );

                // Webhook was valid but there is
                // no payment reference to update.

                return res.json({

                    received: true

                });

            }


            const existing =
                payments.get(reference) || {};


            // =================================================
            // SUCCESS
            // =================================================

            if (
                event ===
                "payment.success"
            ) {

                console.log(
                    "CHATPESA: PAYMENT SUCCESS"
                );


                payments.set(reference, {

                    ...existing,

                    status: "SUCCESS",

                    reference:
                        reference,

                    transactionId:
                        transaction?.id ||
                        null,

                    mpesaReceipt:
                        transaction?.mpesaReceipt ||
                        transaction?.metadata?.mpesaReceipt ||
                        null,

                    callback:
                        body,

                    updatedAt:
                        new Date().toISOString()

                });

            }


            // =================================================
            // FAILED
            // =================================================

            else if (
                event ===
                "payment.failed"
            ) {

                console.log(
                    "CHATPESA: PAYMENT FAILED"
                );


                payments.set(reference, {

                    ...existing,

                    status: "FAILED",

                    reference:
                        reference,

                    transactionId:
                        transaction?.id ||
                        null,

                    callback:
                        body,

                    updatedAt:
                        new Date().toISOString()

                });

            }


            // =================================================
            // OTHER PAYLOR EVENTS
            // =================================================

            else {

                console.log(
                    "CHATPESA: OTHER PAYLOR EVENT"
                );

            }


            // =================================================
            // RESPOND QUICKLY
            // =================================================

            return res.json({

                received: true,

                reference:
                    reference

            });


        } catch (error) {

            console.error(
                "PAYLOR WEBHOOK ERROR:",
                error
            );


            return res.status(500).json({

                received: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// PAYMENT STATUS
// =====================================================

app.get(
    "/payment-status/:reference",
    (req, res) => {

        const reference =
            req.params.reference;


        const payment =
            payments.get(reference);


        if (!payment) {

            return res.json({

                success: true,

                status: "NOT_FOUND",

                reference:
                    reference

            });

        }


        return res.json({

            success: true,

            status:
                payment.status,

            reference:
                payment.reference,

            amount:
                payment.amount,

            phone:
                payment.phone,

            type:
                payment.type ||
                "registration",

            country:
                payment.country ||
                null,

            transactionId:
                payment.transactionId ||
                null,

            mpesaReceipt:
                payment.mpesaReceipt ||
                null,

            error:
                payment.error ||
                null

        });

    }
);


// =====================================================
// COUNTRY PRICES
// =====================================================

app.get(
    "/country-prices",
    (req, res) => {

        res.json({

            success: true,

            prices:
                countryPrices

        });

    }
);


// =====================================================
// SERVER
// =====================================================

app.listen(
    PORT,
    () => {

        console.log(
            `ChatPesa server running on port ${PORT}`
        );

    }
);
