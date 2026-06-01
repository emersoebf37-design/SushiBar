module.exports = {
  apps: [
    {
      name: "kaizora-bot",
      script: "./bot.js",
      watch: false
    },
    {
      name: "kaizora-impressora",
      script: "./Impressora/server.js",
      watch: false
    }
  ]
};