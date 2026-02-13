require('dotenv').config();

const REQUIRED_ENV = ['DISCORD_TOKEN', 'LAVALINK_PASSWORD'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[Startup] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const COMMAND_PREFIX = process.env.PREFIX || '!';

const { Client, GatewayIntentBits } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const searchCache = new Map();

const manager = new LavalinkManager({
  nodes: [
    {
      id: "main",
      host: "127.0.0.1",
      port: 2333,
      authorization: process.env.LAVALINK_PASSWORD
    }
  ],
  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  }
});

/* =========================
   Lavalink Events
========================= */

manager.on("trackStart", (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) channel.send(`🎵 Now playing: ${track.info.title}`);
});

manager.on("queueEnd", (player) => {
  player.destroy();
});

manager.on("nodeConnect", (node) => {
  console.log(`Lavalink node connected: ${node.id}`);
});

manager.on("nodeError", (node, error) => {
  console.error("Lavalink node error:", error);
});

/* =========================
   Discord Ready
========================= */

client.once('clientReady', async (c) => {
  console.log(`[Discord] Logged in as ${c.user.tag}`);
  await manager.init({
    id: c.user.id,
    username: c.user.username
  });
});

/* Forward raw gateway events */
client.on('raw', (d) => manager.sendRawData(d));

/* =========================
   Helpers
========================= */

async function getPlayer(message) {
  let player = manager.getPlayer(message.guild.id);

  if (!player) {
    player = await manager.createPlayer({
      guildId: message.guild.id,
      voiceChannelId: message.member.voice.channel.id,
      textChannelId: message.channel.id,
      selfDeaf: true
    });

    await player.connect();
  }

  return player;
}

/* =========================
   Commands
========================= */

client.on('messageCreate', async (message) => {

  if (message.author.bot || !message.guild) return;

  const content = message.content;
  const cacheKey = `${message.guild.id}:${message.author.id}`;

  /* HELP */
  if (content === `${COMMAND_PREFIX}help`) {
    return message.channel.send(
      `**Music Commands**\n` +
      `\`${COMMAND_PREFIX}play <name/url>\`\n` +
      `\`${COMMAND_PREFIX}search <name>\`\n` +
      `Reply with 1-10 after search\n` +
      `\`${COMMAND_PREFIX}queue\`\n` +
      `\`${COMMAND_PREFIX}skip\`\n` +
      `\`${COMMAND_PREFIX}stop\`\n`
    );
  }

  /* PING */
  if (content === `${COMMAND_PREFIX}ping`) {
    return message.reply(`Pong! ${Date.now() - message.createdTimestamp}ms`);
  }

  /* QUEUE */
  if (content === `${COMMAND_PREFIX}queue`) {
    const player = manager.getPlayer(message.guild.id);
    if (!player || !player.queue?.tracks?.length)
      return message.reply("Queue is empty.");

    let reply = "🎶 Current Queue:\n```";
    player.queue.tracks.slice(0, 10).forEach((t, i) => {
      reply += `\n${i + 1}. ${t.info.title}`;
    });
    reply += "\n```";

    return message.channel.send(reply);
  }

  /* PLAY */
  if (content.startsWith(`${COMMAND_PREFIX}play`)) {
    const query = content.slice(5).trim();
    if (!query) return message.reply("Provide a song name or URL.");
    if (!message.member.voice.channel)
      return message.reply("Join a voice channel first.");
    if (!manager.useable)
      return message.reply("Lavalink not ready yet.");

    const player = await getPlayer(message);

    const result = await player.search({
      query: query.startsWith("http") ? query : `ytsearch:${query}`
    });

    if (!result?.tracks?.length)
      return message.reply("No results found.");

    player.queue.add(result.tracks[0]);

    if (!player.playing && !player.paused)
      await player.play();
  }

  /* SEARCH */
  if (content.startsWith(`${COMMAND_PREFIX}search`)) {
    const query = content.slice(7).trim();
    if (!query) return message.reply("Provide a song name.");
    if (!message.member.voice.channel)
      return message.reply("Join a voice channel first.");
    if (!manager.useable)
      return message.reply("Lavalink not ready yet.");

    const player = await getPlayer(message);

    const result = await player.search({
      query: `ytsearch:${query}`
    });

    if (!result?.tracks?.length)
      return message.reply("No results found.");

    const tracks = result.tracks.slice(0, 10);

    let reply = "**Select a song (1-10):**\n```";
    tracks.forEach((t, i) => {
      reply += `\n${i + 1}. ${t.info.title}`;
    });
    reply += "\n```";

    const sent = await message.channel.send(reply);

    searchCache.set(cacheKey, {
      tracks,
      messageId: sent.id
    });
  }

  /* NUMBER SELECTION */
  if (/^(10|[1-9])$/.test(content)) {
    const cacheEntry = searchCache.get(cacheKey);
    if (!cacheEntry) return;

    const index = parseInt(content) - 1;
    const track = cacheEntry.tracks[index];
    if (!track) return;

    const player = await getPlayer(message);

    player.queue.add(track);

    if (!player.playing && !player.paused)
      await player.play();

    searchCache.delete(cacheKey);
  }

  /* SKIP */
  if (content === `${COMMAND_PREFIX}skip`) {
    const player = manager.getPlayer(message.guild.id);
    if (!player) return message.reply("Nothing playing.");
    player.skip();
  }

  /* STOP */
  if (content === `${COMMAND_PREFIX}stop`) {
    const player = manager.getPlayer(message.guild.id);
    if (!player) return message.reply("Nothing playing.");
    player.destroy();
    message.channel.send("⏹ Stopped.");
  }

});

/* Auto leave if alone */
client.on("voiceStateUpdate", (oldState) => {
  const player = manager.getPlayer(oldState.guild.id);
  if (!player) return;

  const channel = oldState.guild.channels.cache.get(player.voiceChannelId);
  if (!channel) return;

  const nonBots = channel.members.filter(m => !m.user.bot);
  if (nonBots.size === 0) {
    player.destroy();
  }
});

/* Global Error Logging */
client.on('error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(process.env.DISCORD_TOKEN);
