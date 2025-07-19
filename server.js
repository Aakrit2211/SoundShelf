const express = require("express");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
const client = require("./db/client");

dotenv.config();

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

// Spotify Token Handling
let spotifyToken = "";
let spotifyTokenExpiresAt = 0;

async function getSpotifyToken() {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");

  const response = await axios.post("https://accounts.spotify.com/api/token", params, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  spotifyToken = response.data.access_token;
  const ttlMs = (response.data.expires_in || 3600) * 1000;
  spotifyTokenExpiresAt = Date.now() + ttlMs - 5 * 60 * 1000; // refresh 5 mins early
}

async function ensureSpotifyToken() {
  if (!spotifyToken || Date.now() >= spotifyTokenExpiresAt) {
    await getSpotifyToken();
  }
}

// Routes
app.get("/", async (req, res) => {
  try {
    const topGenres = await client.query(
      "SELECT genre, COUNT(*) FROM songs GROUP BY genre ORDER BY COUNT(*) DESC LIMIT 10"
    );
    const topSongs = await client.query(
      "SELECT * FROM songs ORDER BY rating DESC LIMIT 5"
    );
    const allSongs = await client.query(
      "SELECT * FROM songs ORDER BY rating DESC"
    );
    const result = await client.query(
      "SELECT COUNT(DISTINCT artist) AS total_artists FROM songs;"
    );
    const totalArtists = result.rows[0].total_artists;


    res.render("index", {
      topGenres: topGenres.rows,
      topSongs: topSongs.rows,
      allSongs: allSongs.rows,
      artists:totalArtists
    });
  } catch (error) {
    console.error("Error fetching homepage data:", error.message);
    res.status(500).send("Error loading homepage");
  }
});

app.get("/add", (req, res) => {
  res.render("add");
});

app.post("/add", async (req, res) => {
  const { title, artist, rating } = req.body;
  let parsedRating = parseInt(rating, 10);
  if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 10) {
    parsedRating = null; // DB allows null
  }

  try {
    await ensureSpotifyToken();

    const search = await axios.get(`https://api.spotify.com/v1/search`, {
      headers: { Authorization: `Bearer ${spotifyToken}` },
      params: { q: `${title} ${artist}`, type: "track", limit: 1 }
    });

    let cover = "", link = "", realArtist = artist, genre = "Unknown";

    if (search.data.tracks.items.length) {
      const track = search.data.tracks.items[0];
      cover = track.album.images[0]?.url || "";
      link = track.external_urls.spotify;
      realArtist = track.artists[0].name;

      // Get artist genres
      const artistId = track.artists[0].id;
      const artistDetails = await axios.get(`https://api.spotify.com/v1/artists/${artistId}`, {
        headers: { Authorization: `Bearer ${spotifyToken}` }
      });

      if (artistDetails.data.genres.length > 0) {
        genre = artistDetails.data.genres[0];
      }
    }

    await client.query(
      "INSERT INTO songs (title, artist, genre, rating, cover_url, spotify_link) VALUES ($1, $2, $3, $4, $5, $6)",
      [title, realArtist, genre, parsedRating, cover, link]
    );

    res.redirect("/");
  } catch (error) {
    console.error("Error adding song:", error.message);
    res.status(500).send("Something went wrong while adding the song.");
  }
});

app.get("/about", (req, res) => {
  res.render("about");
});

app.post("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await client.query("DELETE FROM songs WHERE id = $1", [id]);
    res.redirect("/");
  } catch (err) {
    console.error("Error deleting song:", err.message);
    res.status(500).send("Failed to delete song.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
