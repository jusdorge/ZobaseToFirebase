// src/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD3ePiDpi58bRXr7LcwqLDJTcQd1mWXJ2I",
  authDomain: "posappai.firebaseapp.com",
  databaseURL: "https://posappai-default-rtdb.firebaseio.com",
  projectId: "posappai",
  storageBucket: "posappai.firebasestorage.app",
  messagingSenderId: "420286289734",
  appId: "1:420286289734:web:5d4cc41b2fdfba02a1b747",
  measurementId: "G-HS2500SN24"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
