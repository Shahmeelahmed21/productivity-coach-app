const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UserModule = require("../models/User");
const User = UserModule?.default || UserModule?.User || UserModule;

const router = express.Router();

function ensureUserModel() {
  if (!User || typeof User.findOne !== "function" || typeof User.create !== "function") {
    throw new TypeError(
      "User model is invalid. Expected ../models/User to export a Mongoose model."
    );
  }
}

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign({ userId: user._id }, secret, { expiresIn });
}

// POST /auth/signup
router.post("/signup", async (req, res) => {
  try {
    ensureUserModel();
    const { name, email, password } = req.body || {};

    if (!email || !String(email).includes("@")) {
      return res.status(400).json({ message: "Valid email is required" });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(409).json({ message: "Email already in use" });

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await User.create({
      name: String(name || "").trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash
    });

    const token = signToken(user);

    res.status(201).json({
      ok: true,
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    ensureUserModel();
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = signToken(user);

    res.json({
      ok: true,
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
