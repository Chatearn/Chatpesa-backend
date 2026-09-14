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
    China: 2,
    Canada: 3,
    Australia: 4,
    UK: 5,
    USA: 6,
    Others: 1
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


        console.log("CHATPESA DATA:", {
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
           REGISTRATION PAYMENT
           MUST BE KSH 1
        --------------------------------------------- */

        if (type === "registration") {

            if (Number(amount) !== 1) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Registration payment must be KSh 1."
                });
            }
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

            if (
                Number(amount) !==
                Number(countryPrices[country])
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Incorrect payment amount for this country."
                });
            }
        }


        /* ---------------------------------------------
           CHECK PAYLOR API KEY
        --------------------------------------------- */

        if (!PAYLOR_API_KEY) {

            console.error(
                "PAYLOR_API_KEY is missing."
            );

            return res.status(500).json({
                success: false,
                message:
                    "Payment gateway is not configured."
            });
        }


        /* ---------------------------------------------
           SAVE INITIAL PAYMENT
        --------------------------------------------- */

        payments.set(reference, {
            reference: reference,
            phone: phone,
            amount: Number(amount),
            type: type || "registration",
            country: country || null,
            status: "PENDING",
            createdAt: Date.now()
        });


        /* ---------------------------------------------
           PAYLOR REQUEST
        --------------------------------------------- */

        const paylorBody = {
            phone: phone,
            amount: Number(amount),
            reference: reference,
            description:
                type === "registration"
                    ? "ChatPesa registration payment"
                    : "ChatPesa country unlock payment",
            callbackUrl:
                `${BACKEND_URL}/paylor-callback`
        };


        if (PAYLOR_CHANNEL_ID) {

            paylorBody.channelId =
                PAYLOR_CHANNEL_ID;
        }


        console.log(
            "CHATPESA CALLBACK URL:",
            paylorBody.callbackUrl
        );

        console.log(
            "CHATPESA: Sending request to Paylor"
        );

        console.log(
            "PAYLOR REQUEST:",
            paylorBody
        );


        const paylorResponse =
            await fetch(
                "https://api.paylorke.com/api/v1/merchants/payments/stk-push",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${PAYLOR_API_KEY}`,

                        "Idempotency-Key":
                            reference
                    },

                    body:
                        JSON.stringify(
                            paylorBody
                        )
                }
            );


        const responseText =
            await paylorResponse.text();


        console.log(
            "PAYLOR HTTP STATUS:",
            paylorResponse.status
        );

        console.log(
            "PAYLOR RESPONSE:",
            responseText
        );


        let paylorData = {};

        try {

            paylorData =
                JSON.parse(responseText);

        } catch (e) {

            paylorData = {
                raw: responseText
            };
        }


        /* ---------------------------------------------
           PAYLOR REQUEST FAILED
        --------------------------------------------- */

        if (!paylorResponse.ok) {

            payments.set(reference, {
                ...payments.get(reference),
                status: "FAILED"
            });

            return res.status(
                paylorResponse.status
            ).json({
                success: false,
                message:
                    paylorData.message ||
                    paylorData.error ||
                    "Paylor payment request failed.",
                data: paylorData
            });
        }


        /* ---------------------------------------------
           PAYMENT ACCEPTED BY PAYLOR
        --------------------------------------------- */

        payments.set(reference, {
            ...payments.get(reference),
            transactionId:
                paylorData.transactionId || null,
            status:
                paylorData.status === "COMPLETED"
                    ? "SUCCESS"
                    : "PENDING"
        });


        return res.json({

            success: true,

            message:
                "M-PESA payment prompt sent.",

            reference: reference,

            transactionId:
                paylorData.transactionId || null,

            status:
                paylorData.status || "PENDING"
        });


    } catch (error) {

        console.error(
            "CHATPESA STK ERROR:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Unable to start payment.",

            error:
                error.message
        });
    }
});


/* =====================================================
   PAYLOR CALLBACK
===================================================== */

app.post("/paylor-callback", (req, res) => {

    console.log("");
    console.log("=================================");
    console.log("PAYLOR CALLBACK RECEIVED");
    console.log("=================================");


    try {

        console.log(
            "PAYLOR CALLBACK BODY:",
            JSON.stringify(
                req.body,
                null,
                2
            )
        );


        /* ---------------------------------------------
           OPTIONAL WEBHOOK SIGNATURE CHECK
        --------------------------------------------- */

        if (PAYLOR_WEBHOOK_SECRET) {

            const signature =
                req.headers[
                    "x-webhook-signature"
                ];

            if (!signature) {

                console.error(
                    "PAYLOR: Missing webhook signature."
                );

                return res.status(401).json({
                    success: false,
                    message:
                        "Missing webhook signature."
                });
            }


            const expectedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        PAYLOR_WEBHOOK_SECRET
                    )
                    .update(
                        req.rawBody
                    )
                    .digest("hex");


            if (
                signature !==
                expectedSignature
            ) {

                console.error(
                    "PAYLOR: Invalid webhook signature."
                );

                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid webhook signature."
                });
            }
        }


        const event =
            req.body?.event;

        const transaction =
            req.body?.transaction;


        if (!transaction) {

            return res.status(400).json({
                success: false,
                message:
                    "Transaction information missing."
            });
        }


        const reference =
            transaction.reference ||
            transaction.internalReference;


        const pay =
            payments.get(reference);


        console.log(
            "CALLBACK REFERENCE:",
            reference
        );


        /* ---------------------------------------------
           PAYMENT SUCCESS
        --------------------------------------------- */

        if (
            event === "payment.success" ||
            transaction.status === "COMPLETED"
        ) {

            console.log(
                "CALLBACK STATUS: success"
            );

            console.log(
                "CHATPESA: PAYMENT SUCCESSFUL"
            );


            if (pay) {

                payments.set(
                    reference,
                    {
                        ...pay,

                        status: "SUCCESS",

                        transactionId:
                            transaction.id ||
                            pay.transactionId,

                        mpesaReceipt:
                            transaction.mpesaReceipt ||
                            null,

                        completedAt:
                            Date.now()
                    }
                );

            } else {

                payments.set(
                    reference,
                    {

                        reference:
                            reference,

                        amount:
                            Number(
                                transaction.amount ||
                                0
                            ),

                        status:
                            "SUCCESS",

                        transactionId:
                            transaction.id ||
                            null,

                        mpesaReceipt:
                            transaction.mpesaReceipt ||
                            null,

                        completedAt:
                            Date.now()
                    }
                );
            }


            return res.json({
                success: true,
                received: true
            });
        }


        /* ---------------------------------------------
           PAYMENT FAILED
        --------------------------------------------- */

        if (
            event === "payment.failed" ||
            transaction.status === "FAILED"
        ) {

            console.log(
                "CALLBACK STATUS: failed"
            );

            console.log(
                "CHATPESA: PAYMENT FAILED"
            );


            if (pay) {

                payments.set(
                    reference,
                    {
                        ...pay,

                        status: "FAILED",

                        failureReason:
                            transaction.metadata
                                ?.callbackResultDesc ||
                            "Payment failed.",

                        failedAt:
                            Date.now()
                    }
                );
            }


            return res.json({
                success: true,
                received: true
            });
        }


        console.log(
            "CHATPESA: UNKNOWN PAYMENT STATUS"
        );


        return res.json({
            success: true,
            received: true
        });


    } catch (error) {

        console.error(
            "CALLBACK ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Callback processing error."
        });
    }
});


/* =====================================================
   PAYMENT STATUS
===================================================== */

app.get(
    "/payment-status/:reference",
    (req, res) => {

        const reference =
            req.params.reference;

        const payment =
            payments.get(reference);


        if (!payment) {

            return res.status(404).json({

                success: false,

                status: "NOT_FOUND",

                message:
                    "Payment reference not found."
            });
        }


        return res.json({

            success: true,

            reference:
                payment.reference,

            status:
                payment.status,

            amount:
                payment.amount,

            type:
                payment.type,

            country:
                payment.country,

            transactionId:
                payment.transactionId ||
                null,

            mpesaReceipt:
                payment.mpesaReceipt ||
                null,

            failureReason:
                payment.failureReason ||
                null
        });
    }
);


/* =====================================================
   SERVER
===================================================== */

app.listen(
    PORT,
    () => {

        console.log(
            `ChatPesa server running on port ${PORT}`
        );
    }
);
