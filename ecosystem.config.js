module.exports = {
  apps: [
    {
      name: "kaizora-bot",
      script: "./bot.js", // Discord + WhatsApp (bot.js importa whatsapp.js internamente)
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "kaizora-impressora",
      script: "./server.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000, // dá tempo pra porta COM/Bluetooth se recuperar antes de tentar de novo
      env: {
        NODE_ENV: "production",
        PRINTER_BT_COM: "COM3",          // ajuste para a porta COM do Bluetooth pareado
        PRINTER_BT_BAUD: "9600",
        PRINTER_USB_SHARE: "\\\\localhost\\POS58",
        PRINTER_BT_RETRIES: "2",
      },
    },
  ],
};
