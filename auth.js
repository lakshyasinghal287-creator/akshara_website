// auth.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const SECRET = 'replace_this_with_a_long_random_secret_in_prod';

function signToken(payload) {
  // token valid for 8 hours
  return jwt.sign(payload, SECRET, { expiresIn: '8h' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (e) {
    return null;
  }
}

async function hashPassword(plain) {
  const saltRounds = 10;
  return await bcrypt.hash(plain, saltRounds);
}

async function comparePassword(plain, hash) {
  return await bcrypt.compare(plain, hash);
}

module.exports = { signToken, verifyToken, hashPassword, comparePassword };
