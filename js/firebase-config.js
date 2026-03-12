// js/firebase-config.js
const firebaseConfig = {
    apiKey: "AIzaSyDAkwCXf6_Fd4jp79tk6YUC9yHynYXjLDQ",
    authDomain: "bridge-go.firebaseapp.com",
    projectId: "bridge-go",
    databaseURL: "https://bridge-go-default-rtdb.firebaseio.com",
    appId: "1:212052576521:web:dd45f303d59f5315ddabd8"
};
firebase.initializeApp(firebaseConfig);
const database = firebase.database();