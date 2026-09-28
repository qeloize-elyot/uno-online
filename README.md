# UNO Online Multiplayer

Jogo completo de UNO multiplayer online com:

- Login e criação de conta
- Salas com código
- Jogo em tempo real (Socket.io)
- Regras clássicas + empilhamento de +2/+4
- Sistema de vitórias
- Funciona no celular

## Como rodar localmente

```bash
npm install
npm start
```

Acesse: http://localhost:3000

## Como hospedar no Render (recomendado)

1. Crie uma conta em [render.com](https://render.com)
2. New → Web Service
3. Conecte o repositório do GitHub
4. Configurações:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Clique em **Create Web Service**

Pronto! O Render vai te dar um link tipo `https://uno-online-xxxx.onrender.com`

## Tecnologias

- Node.js + Express
- Socket.io (tempo real)
- JWT + bcrypt (login seguro)
- HTML/CSS/JS puro
