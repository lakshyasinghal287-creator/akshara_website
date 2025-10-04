// models.js
const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// SQLite file-based DB stored in project
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: false
});

// User model (receptionist/admin)
const User = sequelize.define('User', {
  username: { type: DataTypes.STRING, unique: true },
  passwordHash: DataTypes.STRING,
  role: DataTypes.STRING // 'reception' | 'doctor' | 'admin'
});

// Appointment / Queue entry
const Appointment = sequelize.define('Appointment', {
  token: { type: DataTypes.STRING, unique: true },
  name: DataTypes.STRING,
  age: DataTypes.INTEGER,
  sex: DataTypes.STRING,
  arrivalTime: DataTypes.DATE,    // arrival timestamp
  estConsultMin: DataTypes.INTEGER,
  status: DataTypes.STRING,       // waiting | inconsult | done | noshow
  startTime: DataTypes.DATE,
  endTime: DataTypes.DATE
});

// Consult record (history)
const Consult = sequelize.define('Consult', {
  appointmentId: DataTypes.INTEGER,
  startTime: DataTypes.DATE,
  endTime: DataTypes.DATE,
  durationMin: DataTypes.INTEGER,
  doctor: DataTypes.STRING
});

// Simple audit log
const Log = sequelize.define('Log', {
  user: DataTypes.STRING,
  action: DataTypes.STRING,
  payload: DataTypes.TEXT
});

module.exports = {
  sequelize,
  User,
  Appointment,
  Consult,
  Log
};
