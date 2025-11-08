// types.ts
import { WebSocket } from 'ws';

export interface RuntimePlayer {
    player: Player;
    ws: WebSocket;
    isReady: boolean;
    isFinish: boolean;
    raceStartTime?: number;
    raceFinishTime?: number; 
    raceDuration?: number;
}

export interface Room {
    id: string;
    players: RuntimePlayer[];
    isCountdownStarted: boolean;
	countdownStartTime?: number;
    countdownEndTime?: number;
    matchFoundTimestamp: number;
    finishedPlayers: RuntimePlayer[]; 
    raceDuration?: number;
}

export interface Player {
    id: string;
    teamId: number;
	index: number;
}