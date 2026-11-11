import type { BoardConfig, GameState, Settings } from "./types";

// Plain-data shapes the backend loads and the client receives, so both build the same GameState.

export type PlayerData = {
  _id: string;
  name?: string;
  seatOrder: number;
  cash: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: number;
  status: "playing" | "bankrupt";
  finishPosition?: number;
};

export type PropData = {
  spaceId: string;
  ownerPlayerId: string | null;
  houses: number;
  hotel: boolean;
  mortgaged: boolean;
};

export type GameData = {
  boardSnapshot: BoardConfig;
  settings: Settings;
  freeParkingPot: number;
  bankHouses: number;
  bankHotels: number;
};

export function toGameState(game: GameData, players: PlayerData[], props: PropData[]): GameState {
  const state: GameState = {
    board: game.boardSnapshot,
    settings: game.settings,
    players: {},
    props: {},
    pot: game.freeParkingPot,
    bankHouses: game.bankHouses,
    bankHotels: game.bankHotels,
  };
  for (const p of players) {
    state.players[p._id] = {
      id: p._id,
      name: p.name,
      seat: p.seatOrder,
      cash: p.cash,
      inJail: p.inJail,
      jailTurns: p.jailTurns,
      jailCards: p.jailCards,
      status: p.status,
      finishPosition: p.finishPosition,
    };
  }
  for (const p of props) {
    state.props[p.spaceId] = { owner: p.ownerPlayerId, houses: p.houses, hotel: p.hotel, mortgaged: p.mortgaged };
  }
  return state;
}
