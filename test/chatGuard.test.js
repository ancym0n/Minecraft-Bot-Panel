const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { installChatGuard, cleanChat, splitChat } = require("../src/js/chatGuard");
const { splitIntoMessages } = require("../src/js/ollamaManager");

function fakeBot() {
  const bot = new EventEmitter();
  bot.entity = { position: { x: 0, y: 0, z: 0 } };
  bot._client = { state: "play" };
  bot.sent = [];
  bot.chat = (t) => bot.sent.push(t);
  return bot;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("cleanChat/splitChat remove kick-causing characters and split long text on word boundaries", () => {
  assert.equal(cleanChat("hi\nthere§c red​"), "hi there red");
  assert.equal(cleanChat("qué tal \u2014 ok \u{1F600}", { ascii: true }), "que tal - ok");
  const parts = splitChat("word ".repeat(120).trim());
  assert.ok(parts.length === 3 && parts.every((p) => p.length <= 256 && !p.startsWith(" ")));
  assert.equal(splitChat("/msg Steve " + "x".repeat(400)).length, 1, "commands are never split");
});

test("message splitting still recognizes long dashes in incoming text", () => {
  for (const dash of ["\u2013", "\u2014"]) {
    const text = `abcdefghijklmnopqrstuvwx${dash}abcdefghijklmno`;
    assert.deepEqual(splitIntoMessages(text, 30, 3), [
      `abcdefghijklmnopqrstuvwx${dash}`,
      "abcdefghijklmno",
    ]);
    assert.deepEqual(splitIntoMessages(text, 30, 1), ["abcdefghijklmnopqrstuvwx..."]);
  }
});

test("ChatGuard paces messages, switches to ASCII and resends after 'Plain text only', holds chat when muted", async () => {
  const bot = fakeBot();
  const guard = installChatGuard(bot, { log: () => {} });
  guard.gapMs = 60;
  bot.chat("rn qué pasa");
  bot.chat("second");
  await sleep(20);
  assert.deepEqual(bot.sent, ["rn qué pasa"]);
  // A player saying it must not count; the server saying it does.
  bot.emit("messagestr", "Plain text messages only, please", "chat");
  assert.equal(guard.ascii, false);
  bot.emit("messagestr", "Plain text messages only, please", "system");
  assert.equal(guard.ascii, true);
  await sleep(200);
  assert.deepEqual(bot.sent, ["rn qué pasa", "rn que pasa", "second"]);

  bot.emit("messagestr", "Hey! Sorry, but you can't chat here.", "system");
  assert.ok(guard.status().mutedForMs > 30000);
  bot.chat("are you there");
  bot.chat("/spawn");
  await sleep(200);
  assert.ok(bot.sent.includes("/spawn"), "commands still go through");
  assert.ok(!bot.sent.includes("are you there"), "chat is held while muted");
  guard.clear();
});

test("ChatGuard slows down when the server complains and varies exact repeats", async () => {
  const bot = fakeBot();
  const guard = installChatGuard(bot, { log: () => {} });
  guard.gapMs = 40;
  bot.chat("on it");
  await sleep(10);
  bot.emit("messagestr", "Please slow down! You are chatting too fast.", "system");
  assert.ok(guard.gapMs >= 80);
  guard.gapMs = 40;
  bot.chat("on it");
  await sleep(120);
  assert.deepEqual(bot.sent, ["on it", "on it."]);
  guard.clear();
});
