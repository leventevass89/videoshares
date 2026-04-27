const express = require('express');
const pool = require('./db');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const saltRounds = 10;

// Middleware-ek - EZEKNEK AZ ÚTVONALAK ELŐTT KELL LENNIÜK!
app.use(express.json()); // Emiatt látja a szerver a beküldött adatokat
app.use(express.static('public')); // Emiatt működnek a HTML fájlok a public mappából

// Teszt végpont
app.get('/', (req, res) => {
  res.send('A Node.js szerver fut!');
});

// 7. pont: Videók listázása
app.get('/videos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Video');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Adatbázis hiba' });
  }
});

// 6. pont: Regisztráció hasheléssel és koordinátákkal
app.post('/register', async (req, res) => {
    const { nev, email, jelszo, lat, lng } = req.body;

    try {
        const userCheck = await pool.query('SELECT * FROM Felhasznalo WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Ez az email cím már foglalt!' });
        }

        const hashedJelszo = await bcrypt.hash(jelszo, saltRounds);

        const sql = `
            INSERT INTO Felhasznalo (nev, email, jelszo, lat, lng) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING felhasznalo_id, nev
        `;
        const values = [nev, email, hashedJelszo, lat, lng];
        const result = await pool.query(sql, values);

        res.status(201).json({ 
            message: 'Sikeres regisztráció!', 
            user: result.rows[0] 
        });

    } catch (err) {
        console.error("Hiba a mentésnél:", err.message);
        res.status(500).json({ error: 'Szerver hiba az adatok mentésekor.' });
    }
});

// Bejelentkezés végpont
app.post('/login', async (req, res) => {
    const { email, jelszo } = req.body;
    console.log("Bejelentkezési kísérlet:", email);

    try {
        const result = await pool.query('SELECT * FROM Felhasznalo WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Hibás email cím vagy jelszó!' });
        }

        const user = result.rows[0];
        const match = await bcrypt.compare(jelszo, user.jelszo);

        if (!match) {
            return res.status(401).json({ error: 'Hibás email cím vagy jelszó!' });
        }

        console.log(`Sikeres belépés: ${user.email}`);
        res.json({ 
            message: 'Sikeres bejelentkezés!', 
            userId: user.felhasznalo_id,
            nev: user.nev
        });

    } catch (err) {
        console.error("Login hiba:", err.message);
        res.status(500).json({ error: 'Szerver hiba történt a bejelentkezéskor.' });
    }
});

// Profil adatok lekérése ID alapján
app.get('/user-data/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT nev, email, reg_dat, lat, lng FROM Felhasznalo WHERE felhasznalo_id = $1', 
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Felhasználó nem található' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Hiba az adatok lekérésekor');
    }
});

const multer = require('multer');
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit, hogy ne akadjon el a szerver
});

app.post('/upload', upload.single('videoFile'), async (req, res) => {
    const { cim, leiras, felhasznalo_id, hossz, minoseg } = req.body;
    const videoData = req.file.buffer;

    const metaadatok = {
        hossz: parseInt(hossz),
        minoseg: minoseg
    };

    try {
        const sql = `
            INSERT INTO Video (cim, leiras, video_fajl, metaadatok, felhasznalo_id) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING video_id
        `;
        const values = [cim, leiras, videoData, JSON.stringify(metaadatok), felhasznalo_id];
        
        const result = await pool.query(sql, values);
        res.json({ message: 'Sikeres feltöltés!', videoId: result.rows[0].video_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Hiba a feltöltés során.' });
    }
});

// Videó fájl kiszolgálása (Streaming)
app.get('/video-stream/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT video_fajl FROM Video WHERE video_id = $1', [req.params.id]);
        
        if (result.rows.length === 0) return res.status(404).send('Videó nem található');

        const videoBuffer = result.rows[0].video_fajl;
        
        // Beállítjuk a fejlécet, hogy a böngésző tudja: ez egy videó
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': videoBuffer.length
        });
        
        res.end(videoBuffer);
    } catch (err) {
        console.error(err);
        res.status(500).send('Szerver hiba');
    }
});

// Videó fájl kiszolgálása (Streaming)
app.get('/video-stream/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT video_fajl FROM Video WHERE video_id = $1', [req.params.id]);
        
        if (result.rows.length === 0) return res.status(404).send('Videó nem található');

        const videoBuffer = result.rows[0].video_fajl;
        
        // Beállítjuk a fejlécet, hogy a böngésző tudja: ez egy videó
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': videoBuffer.length
        });
        
        res.end(videoBuffer);
    } catch (err) {
        console.error(err);
        res.status(500).send('Szerver hiba');
    }
});

// Videó adatok (cím, leírás) lekérése
app.get('/video-details/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT v.cim, v.leiras, v.metaadatok, f.nev as feltolto FROM Video v JOIN Felhasznalo f ON v.felhasznalo_id = f.felhasznalo_id WHERE v.video_id = $1', 
            [req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Hiba az adatok lekérésekor' });
    }
});

// Megjegyzések lekérése a videóhoz
app.get('/comments/:videoId', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.szoveg, m.ervenyesseg_eleje, f.nev 
            FROM Megjegyzes m 
            JOIN Felhasznalo f ON m.felhasznalo_id = f.felhasznalo_id 
            WHERE m.video_id = $1 
            ORDER BY m.ervenyesseg_eleje DESC`, 
            [req.params.videoId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Hiba a megjegyzések lekérésekor' });
    }
});

app.post('/comments', async (req, res) => {
    // Figyelj a változónevekre: video_id, felhasznalo_id, szoveg
    const { video_id, felhasznalo_id, szoveg } = req.body;
    
    console.log("Új hozzászólás érkezett:", { video_id, felhasznalo_id, szoveg });

    if (!video_id || !felhasznalo_id || !szoveg) {
        return res.status(400).json({ error: 'Minden mező kitöltése kötelező!' });
    }

    try {
        await pool.query(
            'INSERT INTO Megjegyzes (video_id, felhasznalo_id, szoveg, ervenyesseg_eleje) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
            [video_id, felhasznalo_id, szoveg]
        );
        res.json({ message: 'Megjegyzés hozzáadva!' });
    } catch (err) {
        console.error("Adatbázis hiba mentéskor:", err.message);
        res.status(500).json({ error: 'Hiba a mentéskor: ' + err.message });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Szerver fut: http://localhost:${PORT}`));