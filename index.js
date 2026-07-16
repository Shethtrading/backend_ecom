const express = require("express");
const app = express();
const cors = require("cors");
const job = require("./routes/sendmail");
const pay = require("./routes/selection");
const admin = require("./routes/admin")
const cookieParser = require('cookie-parser');

app.use(express.json());
app.use(cookieParser());
app.set("trust proxy", 1);

app.use(
  cors({
    credentials: true,
    origin: ["https://shethtrading.com", "http://localhost:3000"],
  })
);

app.use("/api/v1", job);
app.use("/api/v1", pay);
app.use("/api/v1", admin)

app.get("/", (req, res) => {
  res.send("Server is up and running!");
});

app.listen(8282, () => {
  console.log("prod server started in port 8282");
});