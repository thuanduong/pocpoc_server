// index.ts
import express, { Request, Response } from "express";
import expressWs from "express-ws";
import { createServer, Server as HTTPServer } from "http";
import { RawData, WebSocket } from "ws";
import dotenv from "dotenv";
import { RuntimePlayer } from "./types";
import { GameManager } from "./src/GameManager";
import cors from "cors";

dotenv.config({ path: `.env` });

const app = expressWs(express()).app;
const httpServer = createServer(app);
const gameManager = new GameManager(); 

app.use(cors({
  origin: ['http://localhost:8000', 'https://thuanduong.github.io'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.ws("/normal_match/:playerId", 
    async (ws: WebSocket, req: express.Request) => {
        const playerId = req.params.playerId;

        if (!playerId) {
            ws.close(1007, "playerId is required");
            return;
        }

        const player: RuntimePlayer = { player: { id: playerId, teamId: 0, index: 0 }, ws: ws, isReady: false, isFinish: false };
        gameManager.addNewPlayer(player);
		

        ws.on("error", (err) => {
            console.error("Error received from player client: ", err);
        });

        ws.on("close", () => {
            gameManager.handlePlayerDisconnect(playerId);
        });

        ws.on("message", (data: RawData, isBinary: boolean) => {
            //console.log(data);
			if (isBinary) {
                console.error("Got binary message ");
                //ws.close(1007, "Cannot find corresponding");
                return;
            }
            gameManager.handlePlayerMessage(playerId, data);
        });
});

app.listen(process.env.PORT, () => {
    console.log(`Server is running and listening on port ${process.env.PORT}`);
});

app.post('/test', async (req, res) => {
    
    try {
      const { playerId } = req.body;
      if (!playerId) {
          return res.status(400).json({ status: "error", message: "playerId is required" });
      }
    } catch (error) {
      console.error("Error finding match:", error);
      res.status(500).json({ status: "error", message: "Failed", details: error });
    }
});
