const express = require('express');
const pool = require('./db');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const saltRounds = 10;

/** FormData / JSON: kat_id lista — max 20, csak érvényes pozitív egészek */
function parseKatIds(raw) {
    let arr = [];
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return [];
        try {
            const parsed = JSON.parse(s);
            arr = Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    const seen = new Set();
    const out = [];
    for (const x of arr) {
        const n = parseInt(String(x), 10);
        if (!Number.isFinite(n) || n < 1) continue;
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(n);
        if (out.length >= 20) break;
    }
    return out;
}

// Middleware-ek - EZEKNEK AZ ÚTVONALAK ELŐTT KELL LENNIÜK!
app.use(express.json()); // Emiatt látja a szerver a beküldött adatokat
app.use(express.static('public')); // Emiatt működnek a HTML fájlok a public mappából

// Teszt végpont
app.get('/', (req, res) => {
  res.send('A Node.js szerver fut!');
});

// Kategóriák a feltöltési űrlaphoz (Kategoria tábla)
app.get('/kategoriak', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT kat_id, megnevezes FROM Kategoria ORDER BY megnevezes'
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});

// 7. pont: Videók listázása (BYTEA nélkül; kategóriák a Video_Kategoria kapcsolótáblából)
app.get('/videos', async (req, res) => {
    try {
        const katId = req.query.kat_id ? parseInt(String(req.query.kat_id), 10) : null;
        const sort = req.query.sort === 'most_viewed' ? 'most_viewed' : 'newest';

        const where = Number.isFinite(katId) && katId > 0
            ? 'WHERE EXISTS (SELECT 1 FROM Video_Kategoria vk2 WHERE vk2.video_id = v.video_id AND vk2.kat_id = $1)'
            : '';

        const orderBy = sort === 'most_viewed'
            ? 'view_count DESC, v.feltoltes_ideje DESC, v.video_id DESC'
            : 'v.feltoltes_ideje DESC, v.video_id DESC';

        const result = await pool.query(`
            SELECT 
                v.video_id,
                v.cim,
                v.leiras,
                v.feltoltes_ideje,
                v.metaadatok,
                v.felhasznalo_id,
                f.nev AS feltolto_nev,
                COALESCE((
                    SELECT COUNT(*)::int
                    FROM Nezettseg n
                    WHERE n.video_id = v.video_id
                ), 0) AS view_count,
                COALESCE(
                    (SELECT json_agg(json_build_object('kat_id', k.kat_id, 'megnevezes', k.megnevezes))
                     FROM Video_Kategoria vk
                     JOIN Kategoria k ON k.kat_id = vk.kat_id
                     WHERE vk.video_id = v.video_id),
                    '[]'::json
                ) AS kategoriak
            FROM Video v
            JOIN Felhasznalo f ON f.felhasznalo_id = v.felhasznalo_id
            ${where}
            ORDER BY ${orderBy}
        `, Number.isFinite(katId) && katId > 0 ? [katId] : []);

        res.json(result.rows);
    } catch (err) {
        console.error('Videók lekérési hiba:', err.message);
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
    let katIds = parseKatIds(req.body.kat_ids);

    console.log(`Upload: cim=${cim}, video size=${videoData.length} bytes, kat_ids=${katIds.join(',')}`);

    const metaadatok = {
        hossz: parseInt(hossz, 10),
        minoseg: minoseg,
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ins = await client.query(
            `INSERT INTO Video (cim, leiras, video_fajl, metaadatok, felhasznalo_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING video_id`,
            [cim, leiras, videoData, JSON.stringify(metaadatok), felhasznalo_id]
        );
        const videoId = ins.rows[0].video_id;

        if (katIds.length > 0) {
            const chk = await client.query(
                'SELECT kat_id FROM Kategoria WHERE kat_id = ANY($1::int[])',
                [katIds]
            );
            const allowed = new Set(chk.rows.map((r) => r.kat_id));
            katIds = katIds.filter((id) => allowed.has(id));
            for (const kid of katIds) {
                await client.query(
                    'INSERT INTO Video_Kategoria (video_id, kat_id) VALUES ($1, $2) ON CONFLICT (video_id, kat_id) DO NOTHING',
                    [videoId, kid]
                );
            }
        }

        await client.query('COMMIT');
        console.log(`Upload successful: video_id=${videoId}`);
        res.json({ message: 'Sikeres feltöltés!', videoId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Hiba a feltöltés során.' });
    } finally {
        client.release();
    }
});

// Videó fájl kiszolgálása (Streaming)
app.get('/video-stream/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT video_fajl FROM Video WHERE video_id = $1', [req.params.id]);
        
        if (result.rows.length === 0) return res.status(404).send('Videó nem található');

        let videoBuffer = result.rows[0].video_fajl;
        
        // Ha a buffer stringként jön vissza (hex formátum), konvertáljuk
        if (typeof videoBuffer === 'string') {
            videoBuffer = Buffer.from(videoBuffer, 'hex');
        }
        
        console.log(`Video stream: id=${req.params.id}, size=${videoBuffer.length} bytes`);
        
        // Beállítjuk a fejlécet, hogy a böngésző tudja: ez egy videó
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': videoBuffer.length,
            'Accept-Ranges': 'none'
        });
        
        res.end(videoBuffer);
    } catch (err) {
        console.error('Video stream error:', err);
        res.status(500).send('Szerver hiba: ' + err.message);
    }
});

// Videó adatok (cím, leírás, kategóriák) lekérése
app.get('/video-details/:id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.cim, v.leiras, v.metaadatok, f.nev AS feltolto,
                COALESCE(
                    (SELECT json_agg(json_build_object('kat_id', k.kat_id, 'megnevezes', k.megnevezes))
                     FROM Video_Kategoria vk
                     JOIN Kategoria k ON k.kat_id = vk.kat_id
                     WHERE vk.video_id = v.video_id),
                    '[]'::json
                ) AS kategoriak
             FROM Video v
             JOIN Felhasznalo f ON v.felhasznalo_id = f.felhasznalo_id
             WHERE v.video_id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Videó nem található' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Hiba az adatok lekérésekor' });
    }
});

// Nézettség rögzítése (egyszerű esemény alapú log)
app.post('/videos/:id/view', async (req, res) => {
    const videoId = parseInt(String(req.params.id), 10);
    const felhasznaloId = parseInt(String(req.body?.felhasznalo_id || ''), 10);
    const duration = Number(req.body?.duration || 0);
    const watchedSeconds = Number(req.body?.watched_seconds || 0);

    if (!Number.isFinite(videoId) || videoId < 1) {
        return res.status(400).json({ error: 'Érvénytelen videó azonosító' });
    }

    // A Nezettseg táblában a PK miatt felhasznalo_id nem lehet NULL
    if (!Number.isFinite(felhasznaloId) || felhasznaloId < 1) {
        return res.status(400).json({ error: 'Bejelentkezés szükséges a nézettség mentéséhez' });
    }

    try {
        const meta = {
            duration: Number.isFinite(duration) ? duration : 0,
            watched_seconds: Number.isFinite(watchedSeconds) ? watchedSeconds : 0,
            source: 'watch-page',
        };

        await pool.query(
            `INSERT INTO Nezettseg (video_id, felhasznalo_id, nezettsegi_adatok, idobelyeg)
             VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)`,
            [videoId, felhasznaloId, JSON.stringify(meta)]
        );
        res.status(201).json({ message: 'Nézettség rögzítve' });
    } catch (err) {
        console.error('View insert error:', err.message);
        res.status(500).json({ error: 'Hiba a nézettség mentésekor' });
    }
});

// Egyszerű kategória alapú ajánlások az aktuális videóhoz
app.get('/video-recommendations/:id', async (req, res) => {
    try {
        const videoId = parseInt(String(req.params.id), 10);
        const rawLimit = parseInt(String(req.query.limit || '5'), 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20) : 5;

        if (!Number.isFinite(videoId) || videoId < 1) {
            return res.status(400).json({ error: 'Érvénytelen videó azonosító' });
        }

        const result = await pool.query(
            `
            SELECT
                v.video_id,
                v.cim,
                v.leiras,
                v.metaadatok,
                v.feltoltes_ideje,
                COUNT(cur.kat_id)::int AS common_cat_count,
                COALESCE(
                    (SELECT json_agg(json_build_object('kat_id', k.kat_id, 'megnevezes', k.megnevezes))
                     FROM Video_Kategoria vk2
                     JOIN Kategoria k ON k.kat_id = vk2.kat_id
                     WHERE vk2.video_id = v.video_id),
                    '[]'::json
                ) AS kategoriak
            FROM Video v
            LEFT JOIN Video_Kategoria vk ON vk.video_id = v.video_id
            LEFT JOIN Video_Kategoria cur
                ON cur.video_id = $1
               AND cur.kat_id = vk.kat_id
            WHERE v.video_id <> $1
            GROUP BY v.video_id, v.cim, v.leiras, v.metaadatok, v.feltoltes_ideje
            ORDER BY common_cat_count DESC, v.feltoltes_ideje DESC, v.video_id DESC
            LIMIT $2
            `,
            [videoId, limit]
        );

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Hiba az ajánlások lekérésekor' });
    }
});

// Megjegyzések lekérése a videóhoz
app.get('/comments/:videoId', async (req, res) => {
    try {
        const sort = req.query.sort === 'relevant' ? 'relevant' : 'newest';
        const orderBy = sort === 'relevant'
            ? 'activity_count DESC, m.ervenyesseg_eleje DESC'
            : 'm.ervenyesseg_eleje DESC';

        const result = await pool.query(
            `
            SELECT
                m.szoveg,
                m.ervenyesseg_eleje,
                f.nev,
                COALESCE(stats.comment_count, 0) AS activity_count
            FROM Megjegyzes m
            JOIN Felhasznalo f ON m.felhasznalo_id = f.felhasznalo_id
            LEFT JOIN (
                SELECT felhasznalo_id, COUNT(*)::int AS comment_count
                FROM Megjegyzes
                GROUP BY felhasznalo_id
            ) stats ON stats.felhasznalo_id = m.felhasznalo_id
            WHERE m.video_id = $1
            ORDER BY ${orderBy}
            `,
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

// Saját lejátszási listák lekérése
app.get('/playlists/user/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                l.lej_id,
                l.listanev,
                COUNT(lv.video_id)::int AS video_count
             FROM lejatszasi_lista l
             LEFT JOIN lista_video lv ON lv.lej_id = l.lej_id
             WHERE l.felhasznalo_id = $1
             GROUP BY l.lej_id, l.listanev
             ORDER BY l.lej_id DESC`,
            [req.params.userId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Playlistek lekérési hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Lejátszási lista létrehozása
app.post('/playlists', async (req, res) => {
    const felhasznaloId = parseInt(req.body?.felhasznalo_id, 10);
    const listanev = req.body?.listanev || req.body?.nev;

    if (!Number.isFinite(felhasznaloId) || felhasznaloId < 1) {
        return res.status(400).json({ error: 'Bejelentkezés szükséges!' });
    }

    if (!listanev || !listanev.trim()) {
        return res.status(400).json({ error: 'A lista neve kötelező!' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO lejatszasi_lista (listanev, felhasznalo_id)
             VALUES ($1, $2)
             RETURNING lej_id, listanev`,
            [listanev.trim(), felhasznaloId]
        );

        res.status(201).json({
            message: 'Lejátszási lista létrehozva!',
            playlist: result.rows[0]
        });

    } catch (err) {
        console.error('Playlist létrehozási hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Lejátszási lista törlése
app.delete('/playlists/:lejId', async (req, res) => {
    const lejId = parseInt(req.params.lejId, 10);
    const felhasznaloId = parseInt(req.body?.felhasznalo_id, 10);

    try {
        const result = await pool.query(
            `DELETE FROM lejatszasi_lista
             WHERE lej_id = $1 AND felhasznalo_id = $2
             RETURNING lej_id`,
            [lejId, felhasznaloId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lista nem található vagy nem a tiéd.' });
        }

        res.json({ message: 'Lejátszási lista törölve.' });
    } catch (err) {
        console.error('Playlist törlési hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Lista videóinak lekérése
app.get('/playlists/:lejId/videos', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                v.video_id,
                v.cim,
                v.leiras,
                v.metaadatok
             FROM lista_video lv
             JOIN video v ON v.video_id = lv.video_id
             WHERE lv.lej_id = $1
             ORDER BY v.feltoltes_ideje DESC`,
            [req.params.lejId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Playlist videók lekérési hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Videó hozzáadása lejátszási listához
app.post('/playlists/:lejId/videos', async (req, res) => {
    const lejId = parseInt(req.params.lejId, 10);
    const videoId = parseInt(req.body?.video_id, 10);
    const felhasznaloId = parseInt(req.body?.felhasznalo_id, 10);

    if (!Number.isFinite(lejId) || !Number.isFinite(videoId) || !Number.isFinite(felhasznaloId)) {
        return res.status(400).json({ error: 'Hiányzó vagy hibás adatok.' });
    }

    try {
        const ownerCheck = await pool.query(
            `SELECT lej_id FROM lejatszasi_lista
             WHERE lej_id = $1 AND felhasznalo_id = $2`,
            [lejId, felhasznaloId]
        );

        if (ownerCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Ehhez a listához nincs jogosultságod.' });
        }

        await pool.query(
            `INSERT INTO lista_video (lej_id, video_id)
             VALUES ($1, $2)
             ON CONFLICT (lej_id, video_id) DO NOTHING`,
            [lejId, videoId]
        );

        res.json({ message: 'Videó hozzáadva a listához.' });
    } catch (err) {
        console.error('Videó playlisthez adási hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Lejátszási lista átnevezése
app.put('/playlists/:lejId', async (req, res) => {
    const lejId = parseInt(req.params.lejId, 10);
    const felhasznaloId = parseInt(req.body?.felhasznalo_id, 10);
    const listanev = req.body?.listanev;

    if (!Number.isFinite(lejId) || lejId < 1) {
        return res.status(400).json({ error: 'Érvénytelen lista azonosító!' });
    }

    if (!Number.isFinite(felhasznaloId) || felhasznaloId < 1) {
        return res.status(400).json({ error: 'Bejelentkezés szükséges!' });
    }

    if (!listanev || !listanev.trim()) {
        return res.status(400).json({ error: 'A lista neve kötelező!' });
    }

    try {
        const result = await pool.query(
            `UPDATE lejatszasi_lista
             SET listanev = $1
             WHERE lej_id = $2
             AND felhasznalo_id = $3
             RETURNING lej_id, listanev`,
            [listanev.trim(), lejId, felhasznaloId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Lista nem található vagy nem a tiéd.'
            });
        }

        res.json({
            message: 'Lejátszási lista átnevezve!',
            playlist: result.rows[0]
        });

    } catch (err) {
        console.error('Playlist átnevezési hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/users/:userId/profile-videos', async (req, res) => {
    try {
        const userResult = await pool.query(
            `SELECT felhasznalo_id, nev, email, reg_dat
             FROM felhasznalo
             WHERE felhasznalo_id = $1`,
            [req.params.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Felhasználó nem található.' });
        }

        const videosResult = await pool.query(
            `SELECT video_id, cim, leiras, metaadatok, feltoltes_ideje
             FROM video
             WHERE felhasznalo_id = $1
             ORDER BY feltoltes_ideje DESC`,
            [req.params.userId]
        );

        res.json({
            user: userResult.rows[0],
            videos: videosResult.rows
        });

    } catch (err) {
        console.error('Feltöltő profil hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Like / unlike = kedvenc videó hozzáadása vagy eltávolítása
app.post('/videos/:videoId/like', async (req, res) => {
    const videoId = parseInt(req.params.videoId, 10);
    const felhasznaloId = parseInt(req.body?.felhasznalo_id, 10);

    if (!Number.isFinite(videoId) || videoId < 1) {
        return res.status(400).json({ error: 'Érvénytelen videó azonosító!' });
    }

    if (!Number.isFinite(felhasznaloId) || felhasznaloId < 1) {
        return res.status(400).json({ error: 'Bejelentkezés szükséges!' });
    }

    try {
        const existing = await pool.query(
            `SELECT 1 FROM kedvenc_video
             WHERE felhasznalo_id = $1 AND video_id = $2`,
            [felhasznaloId, videoId]
        );

        if (existing.rows.length > 0) {
            await pool.query(
                `DELETE FROM kedvenc_video
                 WHERE felhasznalo_id = $1 AND video_id = $2`,
                [felhasznaloId, videoId]
            );

            return res.json({
                liked: false,
                message: 'Kedvelés eltávolítva.'
            });
        }

        await pool.query(
            `INSERT INTO kedvenc_video (felhasznalo_id, video_id)
             VALUES ($1, $2)`,
            [felhasznaloId, videoId]
        );

        res.json({
            liked: true,
            message: 'Videó hozzáadva a kedvencekhez.'
        });

    } catch (err) {
        console.error('Like hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Like állapot + darabszám
app.get('/videos/:videoId/like-status/:userId', async (req, res) => {
    const videoId = parseInt(req.params.videoId, 10);
    const userId = parseInt(req.params.userId, 10);

    try {
        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS like_count
             FROM kedvenc_video
             WHERE video_id = $1`,
            [videoId]
        );

        const likedResult = await pool.query(
            `SELECT 1 FROM kedvenc_video
             WHERE video_id = $1 AND felhasznalo_id = $2`,
            [videoId, userId]
        );

        res.json({
            like_count: countResult.rows[0].like_count,
            liked: likedResult.rows.length > 0
        });

    } catch (err) {
        console.error('Like státusz hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Felhasználó kedvenc videói
app.get('/users/:userId/favorites', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                v.video_id,
                v.cim,
                v.leiras,
                v.metaadatok,
                v.feltoltes_ideje,
                kv.kedveles_ideje
             FROM kedvenc_video kv
             JOIN video v ON v.video_id = kv.video_id
             WHERE kv.felhasznalo_id = $1
             ORDER BY kv.kedveles_ideje DESC`,
            [req.params.userId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Kedvencek lekérési hiba:', err.message);
        res.status(500).json({ error: err.message });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Szerver fut: http://localhost:${PORT}`));