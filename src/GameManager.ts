import { v4 as uuidv4 } from 'uuid';
import { RawData, WebSocket } from 'ws';
import { Player, RuntimePlayer, Room } from "../types";

const MIN_PLAYERS_TO_START = 2;
const MIN_PLAYERS_READY = 2;

const WAIT_JOIN_ROOM_DURATION = 60000;
const COUNT_DOWN_DURATION = 10;
const RACE_DURATION = 120;
const MIN_MAP_ID = 2;
const MAX_MAP_ID = 4;

export class GameManager {
    private matchmakingQueue: RuntimePlayer[] = [];
    private activeWebsockets = new Map<string, WebSocket>();
    private rooms = new Map<string, Room>();

    public addPlayerToQueue(player: RuntimePlayer) {
        this.matchmakingQueue.push(player);
        console.log(`Player ${player.player.id} added to queue. Current queue size: ${this.matchmakingQueue.length}`);
        player.ws.send(JSON.stringify({
            type: "normal",
            cmd: "in_queue",
            code: 202,
            message: "You have been added to the matchmaking queue."
        }));
        this.checkMatchmakingQueue();
    }

    public handlePlayerMessage(playerId: string, data: RawData) {
        try {
            const message = JSON.parse(data.toString());
            console.log(`Message from ${playerId}:`, message);

            switch (message.type) {
                case "ready":
                    this.handleReady(playerId);
                    break;
                case "finish":
                    this.handleFinish(playerId);
                    break;
                // Add other message types here
            }
        } catch (error) {
            console.error("Failed to parse or handle message:", error);
        }
    }

    public handlePlayerDisconnect(playerId: string) {
        console.log("Closing websocket for player:", playerId);
        this.activeWebsockets.delete(playerId);
        const playerIndex = this.matchmakingQueue.findIndex(p => p.player.id === playerId);
        if (playerIndex > -1) {
            this.matchmakingQueue.splice(playerIndex, 1);
        }
    }

    private checkMatchmakingQueue() {
        if (this.matchmakingQueue.length >= MIN_PLAYERS_TO_START) {
            const playersToMatch = this.matchmakingQueue.splice(0, MIN_PLAYERS_TO_START);
            const validPlayers = playersToMatch.filter(p => p.ws.readyState === 1);

            if (validPlayers.length < MIN_PLAYERS_TO_START) {
                console.warn(`Not enough valid players. Found: ${validPlayers.length}. Pushing back to queue.`);
                this.matchmakingQueue.unshift(...validPlayers);
                return;
            }

            const roomId = uuidv4();
            const mapId = Math.floor(Math.random() * (MAX_MAP_ID - MIN_MAP_ID + 1)) + MIN_MAP_ID;

            console.log(`Match found! Creating room ${roomId} for players: ${validPlayers.map(p => p.player.id).join(', ')}`);

            const newRoom: Room = {
                id: roomId,
                players: validPlayers,
                isCountdownStarted: false,
                matchFoundTimestamp: Date.now(),
                finishedPlayers: [],
                raceDuration: RACE_DURATION,
            };
            this.rooms.set(roomId, newRoom);

            const playersData = validPlayers.map(p => p.player);
            
            for (let a = 0; a < playersData.length; a++){
                const nm = a;
                playersData[a].teamId = nm;
				playersData[a].index = nm;
            }

            let index = 0;
            validPlayers.forEach(p => {
                if (p.ws.readyState === 1) {
                    p.ws.send(JSON.stringify({
                        type: "normal",
                        cmd: "matchFound",
                        code: 200,
                        roomId: roomId,
                        mapId: mapId,
                        index: index,
                        players: playersData
                    }));
                    index++;
					console.log(`index ${index}`);
                }
            });

            setTimeout(() => this.checkRoomTimeout(newRoom.id), WAIT_JOIN_ROOM_DURATION);
        }
    }

    private handleReady(playerId: string) {
        const room = Array.from(this.rooms.values()).find(r => r.players.some(p => p.player.id === playerId));
        if (room) {
            const player = room.players.find(p => p.player.id === playerId);
            if (player) {
                player.isReady = true;
                console.log(`Player ${playerId} is now ready in room ${room.id}.`);
                this.checkAllPlayersReady(room);
            }
	    else 
		console.log(`Player ${playerId} is not in this room.`);
        }
        else 
            console.log(`Player ${playerId} is not in any room.`);
    }

    private handleFinish(playerId: string) {
        const room = Array.from(this.rooms.values()).find(r => r.players.some(p => p.player.id === playerId));
        if (room) {
            const player = room.players.find(p => p.player.id === playerId);
            if (player && !player.raceFinishTime) {
                player.raceFinishTime = Date.now();
                if (player.raceStartTime) {
                    const durationInMilliseconds = player.raceFinishTime - player.raceStartTime;
                    player.raceDuration = durationInMilliseconds;
                    console.log(`Player ${playerId} finished race in ${player.raceDuration}.`);
                }
                room.finishedPlayers.push(player);
                this.updateRanking(room, player);
            }
        }
    }

    private checkAllPlayersReady(room: Room) {
        if (room.isCountdownStarted) {
			console.log(`Room ${room.id} are countdown.`);
			this.restartCountdown(room);
            return;
        }
        const allReady = room.players.every(p => p.isReady);
        if (allReady) {
            console.log(`All players in room ${room.id} are ready. Starting countdown.`);
            this.startCountdown(room);
        }
    }

    private startCountdown(room: Room) {
        if (room.isCountdownStarted) return;
        room.isCountdownStarted = true;
        const countdownDuration = COUNT_DOWN_DURATION;
        const raceStartTime = Date.now();
		const utcStartTime = this.converTimeToUTCSecond(raceStartTime);
        const utcEndTimeStampInSeconds = utcStartTime + countdownDuration;
        room.countdownEndTime = utcEndTimeStampInSeconds;
		room.countdownStartTime = raceStartTime;

        room.players.forEach(player => {
            if (player.ws.readyState === 1) {
                player.raceStartTime = raceStartTime;
                player.ws.send(JSON.stringify({
                    type: "normal",
                    cmd: "startCountdown",
                    code: 200,
                    endTime: utcEndTimeStampInSeconds,
					startTime: utcStartTime,
                    raceDuration: RACE_DURATION,
                }));
            }
        });

        setTimeout(() => this.handleRaceTimeout(room.id), RACE_DURATION * 1000);
    }

    private restartCountdown(room: Room) {
		const raceStartTime = Date.now();
		const utcStartTime = this.converTimeToUTCSecond(raceStartTime);
        room.players.forEach(player => {
            if (player.ws.readyState === 1) {
                player.raceStartTime = room.countdownStartTime;
                player.ws.send(JSON.stringify({
                    type: "normal",
                    cmd: "startCountdown",
                    code: 200,
                    endTime: room.countdownEndTime,
					startTime : utcStartTime,
                    raceDuration: RACE_DURATION,
                }));
            }
        });
    }
    
    private updateRanking(room: Room, justFinishedPlayer: RuntimePlayer) {
        const currentRankedPlayers = [...room.finishedPlayers].sort((a, b) => {
            const aDuration = a.raceDuration ?? Infinity;
            const bDuration = b.raceDuration ?? Infinity;
            return (aDuration as number) - (bDuration as number);
        });

        const playerRank = currentRankedPlayers.findIndex(p => p.player.id === justFinishedPlayer.player.id) + 1;

        room.players.forEach(p => {
            if (p.ws.readyState === 1) {
                p.ws.send(JSON.stringify({
                    type: "normal",
                    cmd: "racfinisheRanking",
                    code: 200,
                    rank: playerRank,
                    playerId: justFinishedPlayer.player.id,
                    duration: justFinishedPlayer.raceDuration
                }));
            }
        });

        if (room.finishedPlayers.length === room.players.length) {
            console.log(`Race in room ${room.id} is finished. Final ranking:`);
            const finalRankings = currentRankedPlayers.map((player, index) => ({
                rank: index + 1,
                playerId: player.player.id,
                duration: player.raceDuration
            }));
            console.log(finalRankings);
            room.players.forEach(p => {
                if (p.ws.readyState === 1) {
                    p.ws.send(JSON.stringify({
                        type: "normal",
                        cmd: "raceRanking",
                        code: 200,
                        rankings: finalRankings
                    }));
                }
            });
            this.rooms.delete(room.id);
        }
    }

    private handleRaceTimeout(roomId: string) {
        const room = this.rooms.get(roomId);
        if (room) {
            console.log(`Race in room ${roomId} timed out. Cleaning up.`);
            const finishedPlayersIds = room.finishedPlayers.map(p => p.player.id);
            room.players.forEach(p => {
                if (p.ws.readyState === 1 && !finishedPlayersIds.includes(p.player.id)) {
                    p.ws.send(JSON.stringify({
                        type: "normal",
                        cmd: "raceTimeout",
                        code: 400,
                        message: "Race has ended due to time limit."
                    }));
                }
            });
            this.rooms.delete(roomId);
        }
    }

    private checkRoomTimeout(roomId: string) {
        const room = this.rooms.get(roomId);
        if (!room || room.isCountdownStarted) {
            return;
        }

        const readyPlayers = room.players.filter(p => p.isReady);
        const notReadyPlayers = room.players.filter(p => !p.isReady);

        if (readyPlayers.length >= MIN_PLAYERS_READY) { 
            console.log(`Timeout for room ${roomId}. Found ${readyPlayers.length} ready players (min ${MIN_PLAYERS_READY}). Removing ${notReadyPlayers.length} not-ready players and starting countdown.`);
            
            notReadyPlayers.forEach(p => {
                if (p.ws.readyState === 1) {
                    p.ws.close(1000, "Timeout: Did not ready up in time.");
                }
            });

            room.players = readyPlayers;
            this.startCountdown(room);
        }else {
            console.log(`Room ${roomId} failed to start due to insufficient ready players.`);
            
            room.players.forEach(p => {
                if (p.ws.readyState === 1) {
                    p.ws.send(JSON.stringify({
                        type: "normal",
                        cmd: "matchFailed",
                        code: 408,
                        message: "Match failed to start due to other players not readying up."
                    }));
                }
            });
            this.rooms.delete(roomId);
        }
    }

    private converTimeToUTCSecond(time: number) {
        return Math.floor(time / 1000);
    }
}