import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA88YghOMwCTblaAiUqK2wwQTgcIUEhJkc",
  authDomain: "panipat-895ad.firebaseapp.com",
  projectId: "panipat-895ad",
  storageBucket: "panipat-895ad.firebasestorage.app",
  messagingSenderId: "261444716537",
  appId: "1:261444716537:web:9a14fbe25a6907d132df28"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
