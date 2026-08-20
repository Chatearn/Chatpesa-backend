const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 10000;

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
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

app.use(express.json());


// =========================================
// PAYMENT STORAGE
// =========================================

const payments = new Map();


// =========================================
// HEALTH CHECK
// =========================================

app.get("/", (req, res) => {
    res.json({
        status: "online",
        service: "ChatPesa API"
    });
});


// =========================================
// STK PUSH
// =========================================

app.post("/stk-push", async (req, res) => {

    console.log("=================================");
    console.log("CHATPESA: STK REQUEST RECEIVED");
    console.log("=================================");

    console.log("CHATPESA DATA:", req.body);

    try {

        const {
            phone,
            amount,
            reference
        } = req.body;


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


        if (!process.env.PAYLOR_API_KEY) {

            return res.status(500).json({
                success: false,
                error: "Paylor API key is not configured."
            });

        }


        // =====================================
        // CALLBACK URL
        // =====================================

        const backendUrl =
            process.env.BACKEND_URL ||
            "https://chatpesa-backend.onrender.com";

        const callbackUrl =
            `${backendUrl}/paylor-callback`;


        console.log(
            "CHATPESA CALLBACK URL:",
            callbackUrl
        );


        // =====================================
        // SAVE PENDING PAYMENT
        // =====================================

        payments.set(reference, {
            status: "PENDING",
            phone: phone,
            amount: Number(amount),
            reference: reference
        });


        // =====================================
        // PAYLOR REQUEST
        // =====================================

        const paylorData = {

            phone: phone,

            amount: Number(amount),

            reference: reference,

            description:
                "ChatPesa registration payment",

            callbackUrl:
                callbackUrl

        };


        if (process.env.PAYLOR_CHANNEL_ID) {

            paylorData.channelId =
                process.env.PAYLOR_CHANNEL_ID;

        }


        console.log(
            "CHATPESA: Sending request to Paylor"
        );

        console.log(
            "PAYLOR REQUEST:",
            paylorData
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


        // =====================================
        // PAYLOR ERROR
        // =====================================

        if (!response.ok) {

            payments.set(reference, {

                status: "FAILED",

                phone: phone,

                amount: Number(amount),

                reference: reference,

                error:
                    data.message ||
                    data.error ||
                    "Paylor STK Push failed."

            });


            return res.status(
                response.status
            ).json({

                success: false,

                error:
                    data.message ||
                    data.error ||
                    "Paylor STK Push failed.",

                paylor:
                    data

            });

        }


        // =====================================
        // STK SENT
        // =====================================

        return res.json({

            success: true,

            message:
                "STK Push sent successfully.",

            reference:
                reference,

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


// =========================================
// PAYLOR CALLBACK
// =========================================

app.post("/paylor-callback", (req, res) => {

    console.log("");
    console.log("=================================");
    console.log("PAYLOR CALLBACK RECEIVED");
    console.log("=================================");

    console.log(
        "PAYLOR CALLBACK BODY:",
        JSON.stringify(
            req.body,
            null,
            2
        )
    );


    try {

        const body = req.body || {};


        // =====================================
        // FIND REFERENCE
        // =====================================

        const reference =
            body.reference ||
            body.external_reference ||
            body.externalReference ||
            body.transaction?.reference ||
            body.data?.reference ||
            body.payment?.reference;


        // =====================================
        // FIND STATUS
        // =====================================

        const status =
            String(
                body.status ||
                body.transaction?.status ||
                body.data?.status ||
                body.payment?.status ||
                body.event ||
                ""
            ).toLowerCase();


        console.log(
            "CALLBACK REFERENCE:",
            reference
        );

        console.log(
            "CALLBACK STATUS:",
            status
        );


        if (!reference) {

            console.error(
                "Callback reference not found."
            );

            return res.json({
                received: true
            });

        }


        const existing =
            payments.get(reference) || {};


        // =====================================
        // SUCCESS
        // =====================================

        if (
            status === "success" ||
            status === "successful" ||
            status === "completed" ||
            status === "complete" ||
            status === "paid" ||
            status === "payment.success"
        ) {

            console.log(
                "CHATPESA: PAYMENT SUCCESS"
            );


            payments.set(reference, {

                ...existing,

                status: "SUCCESS",

                reference: reference,

                transactionId:
                    body.transactionId ||
                    body.transaction?.id ||
                    body.data?.transactionId ||
                    body.data?.id ||
                    null,

                callback:
                    body,

                updatedAt:
                    new Date().toISOString()

            });

        }


        // =====================================
        // FAILED
        // =====================================

        else if (
            status === "failed" ||
            status === "failure" ||
            status === "cancelled" ||
            status === "canceled" ||
            status === "rejected" ||
            status === "declined" ||
            status === "payment.failed"
        ) {

            console.log(
                "CHATPESA: PAYMENT FAILED"
            );


            payments.set(reference, {

                ...existing,

                status: "FAILED",

                reference: reference,

                callback:
                    body,

                updatedAt:
                    new Date().toISOString()

            });

        }


        // =====================================
        // UNKNOWN
        // =====================================

        else {

            console.log(
                "CHATPESA: UNKNOWN PAYMENT STATUS"
            );


            payments.set(reference, {

                ...existing,

                status:
                    "CALLBACK_RECEIVED",

                reference: reference,

                callback:
                    body,

                updatedAt:
                    new Date().toISOString()

            });

        }


        return res.json({

            received: true,

            reference: reference

        });


    } catch (error) {

        console.error(
            "CALLBACK ERROR:",
            error
        );

        return res.status(500).json({

            received: false,

            error:
                error.message

        });

    }

});


// =========================================
// PAYMENT STATUS
// =========================================

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

                status:
                    "NOT_FOUND",

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

            transactionId:
                payment.transactionId ||
                null

        });

    }
);


// =========================================
// SERVER
// =========================================

app.listen(PORT, () => {

    console.log(
        `ChatPesa server running on port ${PORT}`
    );

});
. 
