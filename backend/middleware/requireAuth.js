const jwt = require("jsonwebtoken");

module.exports = function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ message: "Unauthorized", detail: "Missing Bearer token" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ message: "Server misconfig", detail: "JWT_SECRET missing" });
    }

    const payload = jwt.verify(token, secret);
    req.userId = String(payload.userId);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized", detail: err.message });
  }
};

