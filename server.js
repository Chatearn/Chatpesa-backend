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

    console.log(
        "CHATPESA: STK request received"
    );

    console.log(
        "CHATPESA DATA:",
        req.body
    );


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


    /*
       TEMPORARY TEST RESPONSE

       This confirms that the frontend
       can successfully communicate
       with the backend.
    */

    console.log(
        "CHATPESA: Request accepted"
    );


    return res.json({

        success: true,

        message: "STK request received by ChatPesa.",

        phone: phone,

        amount: amount,

        reference: reference

    });

});


/* =========================================
   START SERVER
========================================= */

app.listen(PORT, () => {

    console.log(
        `ChatPesa server running on port ${PORT}`
    );

});
