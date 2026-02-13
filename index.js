require('dotenv').config();

const REQUIRED_ENV = ['DISCORD_TOKEN', 'LAVALINK_PASSWORD'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[Startup Error] Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const COMMAND_PREFIX = process.env.PREFIX || '!';

const { Client, GatewayIntentBits } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
const express = require("express");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

console.log("[Startup] Bot process started.");

/* =========================
   LAVALINK SETUP
========================= */

const manager = new LavalinkManager({
  nodes: [
    {
      id: "main",
      host: "discord-music-bot-1-zemi.onrender.com", // CHANGE IF DIFFERENT
      port: 443,
      secure: true,
      authorization: process.env.LAVALINK_PASSWORD
    }
  ],
  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  }
});

/* Lavalink Events */

manager.on("nodeConnect", (node) => {
  console.log(`[Lavalink] Connected to node: ${node.id}`);
});

manager.on("nodeError", (node, error) => {
  console.error(`[Lavalink] Node error on ${node.id}:`, error);
});

manager.on("trackStart", (player, track) => {
  console.log(`[Player] Track started: ${track.info.title}`);
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) channel.send(`🎵 Now playing: ${track.info.title}`);
});

manager.on("queueEnd", (player) => {
  console.log("[Player] Queue ended. Destroying player.");
  player.destroy();
});

/* =========================
   DISCORD READY
========================= */

client.once('clientReady', async (c) => {
  console.log(`[Discord] Logged in as ${c.user.tag}`);

  try {
    await manager.init({
      id: c.user.id,
      username: c.user.username
    });
    console.log("[Lavalink] Manager initialized.");
  } catch (err) {
    console.error("[Lavalink] Failed to initialize manager:", err);
  }
});

/* Raw event forwarding */
client.on('raw', (d) => manager.sendRawData(d));

/* =========================
   SIMPLE COMMAND (for testing)
========================= */

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content;

  if (content === "!ping") {
    return message.reply("Bot is alive.");
  }

  if (content.startsWith("!play")) {
    if (!message.member.voice.channel)
      return message.reply("Join a voice channel first.");

    if (!manager.useable) {
      console.error("[Lavalink] Manager not usable.");
      return message.reply("Lavalink not ready.");
    }

    const query = content.slice(5).trim();
    if (!query) return message.reply("Provide a song name.");

    try {
      let player = manager.getPlayer(message.guild.id);

      if (!player) {
        console.log("[Player] Creating new player.");
        player = await manager.createPlayer({
          guildId: message.guild.id,
          voiceChannelId: message.member.voice.channel.id,
          textChannelId: message.channel.id,
          selfDeaf: true
        });

        await player.connect();
        console.log("[Player] Connected to voice.");
      }

      const result = await player.search({
        query: `ytsearch:${query}`
      });

      if (!result?.tracks?.length) {
        console.log("[Search] No results found.");
        return message.reply("No results found.");
      }

      player.queue.add(result.tracks[0]);

      if (!player.playing) {
        await player.play();
      }

    } catch (err) {
      console.error("[Play Command Error]", err);
      message.reply("Error while playing track.");
    }
  }
});

/* =========================
   EXPRESS SERVER FOR RENDER
========================= */

const app = express();
const PORT = process.env.PORT;

app.get("/", (req, res) => {
  res.send("Bot is running.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Express] Listening on port ${PORT}`);
});

/* =========================
   GLOBAL ERROR HANDLING
========================= */

client.on('error', (err) => {
  console.error("[Discord Client Error]", err);
});

process.on('unhandledRejection', (err) => {
  console.error("[Unhandled Rejection]", err);
});

process.on('uncaughtException', (err) => {
  console.error("[Uncaught Exception]", err);
});

/* =========================
   LOGIN
========================= */

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("[Discord] Login successful."))
  .catch(err => {
    console.error("[Discord] Login failed:", err);
    process.exit(1);
  });
