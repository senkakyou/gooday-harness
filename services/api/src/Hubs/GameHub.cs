// =====================================================
// Hubs/GameHub.cs —— 多人游戏 SignalR Hub
// WebSocket 端点：/hubs/game
// 职责：管理棋桌（房间）、玩家坐席分配、实时同步对局状态
//
// 游戏规则逻辑见：
//   ChessEngine.cs  —— 象棋走法验证 + 将军/绝杀判断
//   GomokuEngine.cs —— 五子棋连五判断
//   GameModels.cs   —— 共享数据结构
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;

namespace GoodayTools.Hubs;

public class GameHub : Hub
{
    private static readonly object Lock = new();

    private static readonly Dictionary<string, List<GameTable>> Tables = new()
    {
        ["gomoku"] = Enumerable.Range(1, 8).Select(i => new GameTable { Id = i, GameType = "gomoku" }).ToList(),
        ["chess"]  = Enumerable.Range(1, 8).Select(i => new GameTable { Id = i, GameType = "chess"  }).ToList(),
    };

    private static readonly Dictionary<string, (string gt, int tid, int seat)> SeatMap = new();

    // ── 工具 ─────────────────────────────────────────────────────────────────

    private (int? userId, string username) GetCaller()
    {
        var uid  = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "游客";
        return (uid == null ? null : int.Parse(uid), name);
    }

    private static object TableDto(GameTable t) => new
    {
        id = t.Id, gameType = t.GameType, state = t.State,
        seat0 = t.Seats[0] == null ? null : new { t.Seats[0]!.Username, t.Seats[0]!.Level },
        seat1 = t.Seats[1] == null ? null : new { t.Seats[1]!.Username, t.Seats[1]!.Level },
    };

    private static string LobbyGroup(string gt) => $"lobby-{gt}";
    private static string TableGroup(int tid)    => $"table-{tid}";

    private static void ResetTable(GameTable t)
    {
        t.State = "open"; t.Seats[0] = null; t.Seats[1] = null;
        t.GomokuBoard.Clear(); t.ChessBoard.Clear();
    }

    // ── 进入大厅 ──────────────────────────────────────────────────────────────

    public async Task JoinLobby(string gameType)
    {
        if (!Tables.ContainsKey(gameType)) return;
        await Groups.AddToGroupAsync(Context.ConnectionId, LobbyGroup(gameType));
        List<object> dtos;
        lock (Lock) dtos = Tables[gameType].Select(TableDto).ToList();
        await Clients.Caller.SendAsync("TableList", dtos);
    }

    // ── 入座 ─────────────────────────────────────────────────────────────────

    public async Task SitDown(string gameType, int tableId, int seatIndex)
    {
        if (!Tables.ContainsKey(gameType)) return;
        var (userId, username) = GetCaller();

        GameTable? table = null;
        bool startGomoku = false, startChess = false, rejoinGomoku = false;

        lock (Lock)
        {
            var tables = Tables[gameType];

            if (SeatMap.TryGetValue(Context.ConnectionId, out var cur))
            {
                var old = tables.FirstOrDefault(t => t.Id == cur.tid);
                if (old != null) { old.Seats[cur.seat] = null; if (old.State != "playing") old.State = "open"; }
                SeatMap.Remove(Context.ConnectionId);
            }

            table = tables.FirstOrDefault(t => t.Id == tableId);
            if (table == null || seatIndex < 0 || seatIndex > 1) return;

            if (table.Seats[seatIndex] != null)
            {
                if (userId != null && table.Seats[seatIndex]!.UserId == userId)
                {
                    SeatMap.Remove(table.Seats[seatIndex]!.ConnectionId);
                    table.Seats[seatIndex]!.ConnectionId = Context.ConnectionId;
                    SeatMap[Context.ConnectionId] = (gameType, tableId, seatIndex);
                    if (table.State == "playing" && table.GameType == "gomoku") rejoinGomoku = true;
                }
                else return;
            }
            else
            {
                if (table.State == "playing") return;
                table.Seats[seatIndex] = new GameSeat { ConnectionId = Context.ConnectionId, UserId = userId, Username = username };
                SeatMap[Context.ConnectionId] = (gameType, tableId, seatIndex);

                if (table.Seats[0] != null && table.Seats[1] != null)
                {
                    table.State = "playing"; table.CurrentTurn = 0;
                    if (table.GameType == "gomoku") { table.GomokuBoard.Clear(); startGomoku = true; }
                    else if (table.GameType == "chess") { table.ChessBoard = ChessEngine.InitBoard(); startChess = true; }
                }
                else table.State = "open";
            }
        }

        if (table == null) return;
        await Groups.AddToGroupAsync(Context.ConnectionId, TableGroup(tableId));
        await Clients.Caller.SendAsync("YouSat", new { tableId, seatIndex, gameType });

        if (rejoinGomoku)
        {
            Dictionary<string, int> snapshot;
            lock (Lock) snapshot = new Dictionary<string, int>(table.GomokuBoard);
            await Clients.Caller.SendAsync("GomokuRejoined", new {
                yourSide = seatIndex, opponentName = table.Seats[1-seatIndex]?.Username ?? "",
                currentTurn = table.CurrentTurn, board = snapshot,
            });
            return;
        }

        await Clients.Group(LobbyGroup(gameType)).SendAsync("TableUpdated", TableDto(table));

        if (startGomoku)
        {
            await Clients.Client(table.Seats[0]!.ConnectionId).SendAsync("GomokuStarted",
                new { yourSide = 0, firstTurn = 0, opponentName = table.Seats[1]!.Username });
            await Clients.Client(table.Seats[1]!.ConnectionId).SendAsync("GomokuStarted",
                new { yourSide = 1, firstTurn = 0, opponentName = table.Seats[0]!.Username });
            await Clients.Group(LobbyGroup(gameType)).SendAsync("TableUpdated", TableDto(table));
        }
        else if (startChess)
        {
            await Clients.Client(table.Seats[0]!.ConnectionId).SendAsync("ChessStarted",
                new { yourSide = 0, opponentName = table.Seats[1]!.Username });
            await Clients.Client(table.Seats[1]!.ConnectionId).SendAsync("ChessStarted",
                new { yourSide = 1, opponentName = table.Seats[0]!.Username });
            await Clients.Group(LobbyGroup(gameType)).SendAsync("TableUpdated", TableDto(table));
        }
    }

    // ── 起身 ─────────────────────────────────────────────────────────────────

    public async Task StandUp() => await HandleStandUp(Context.ConnectionId, notifyOpponent: true);

    private async Task HandleStandUp(string connId, bool notifyOpponent)
    {
        string gameType = ""; int tableId = 0;
        GameTable? table = null; string? oppConnId = null;

        lock (Lock)
        {
            if (!SeatMap.TryGetValue(connId, out var cur)) return;
            gameType = cur.gt; tableId = cur.tid;
            table = Tables[gameType].FirstOrDefault(t => t.Id == cur.tid);
            if (table == null) return;
            var other = 1 - cur.seat;
            if (table.Seats[other] != null) oppConnId = table.Seats[other]!.ConnectionId;
            table.Seats[cur.seat] = null; table.State = "open"; table.GomokuBoard.Clear();
            SeatMap.Remove(connId);
        }

        if (table == null) return;
        await Groups.RemoveFromGroupAsync(connId, TableGroup(tableId));
        await Clients.Group(LobbyGroup(gameType)).SendAsync("TableUpdated", TableDto(table));
        if (notifyOpponent && oppConnId != null)
            await Clients.Client(oppConnId).SendAsync("OpponentLeft");
    }

    // ── 五子棋：落子 ─────────────────────────────────────────────────────────

    public async Task PlaceStone(int col, int row)
    {
        if (!SeatMap.TryGetValue(Context.ConnectionId, out var cur)) return;
        var table = Tables[cur.gt].FirstOrDefault(t => t.Id == cur.tid);
        if (table == null || table.State != "playing" || table.GameType != "gomoku") return;
        if (table.CurrentTurn != cur.seat) return;
        if (col < 0 || col >= 15 || row < 0 || row >= 15) return;

        var k = $"{col},{row}";
        bool won;
        lock (Lock)
        {
            if (table.GomokuBoard.ContainsKey(k)) return;
            table.GomokuBoard[k] = cur.seat;
            won = GomokuEngine.CheckWin(table.GomokuBoard, col, row, cur.seat);
            if (won) table.State = "ended"; else table.CurrentTurn = 1 - cur.seat;
        }

        var oppConnId = table.Seats[1 - cur.seat]?.ConnectionId;
        await Clients.Group(TableGroup(cur.tid)).SendAsync("StoneResult", new {
            col, row, side = cur.seat,
            currentTurn    = won ? -1 : table.CurrentTurn,
            winnerSide     = won ? (int?)cur.seat : null,
            winnerUsername = won ? table.Seats[cur.seat]?.Username : null,
        });

        if (won) await FinishGame(cur.gt, cur.tid, oppConnId);
    }

    // ── 象棋：走棋 ────────────────────────────────────────────────────────────

    public async Task ChessMove(int pieceId, int toCol, int toRow)
    {
        if (!SeatMap.TryGetValue(Context.ConnectionId, out var cur)) return;
        var table = Tables[cur.gt].FirstOrDefault(t => t.Id == cur.tid);
        if (table == null || table.State != "playing" || table.GameType != "chess") return;
        if (table.CurrentTurn != cur.seat) return;
        if (toCol < 0 || toCol > 8 || toRow < 0 || toRow > 9) return;

        int? capturedId = null; bool gameOver = false;
        int winnerSide = -1; string? winnerUsername = null; int? checkSideVal = null;

        lock (Lock)
        {
            var piece = table.ChessBoard.FirstOrDefault(p => p.Alive && p.Id == pieceId && p.Side == cur.seat);
            if (piece == null || !ChessEngine.IsLegal(table.ChessBoard, piece, toCol, toRow)) return;

            var captured = table.ChessBoard.FirstOrDefault(p => p.Alive && p.Col == toCol && p.Row == toRow && p.Side != cur.seat);
            if (captured != null) { captured.Alive = false; capturedId = captured.Id; }
            piece.Col = toCol; piece.Row = toRow;

            int nextTurn = 1 - cur.seat;
            if (ChessEngine.InCheck(table.ChessBoard, nextTurn)) checkSideVal = nextTurn;
            if (!ChessEngine.HasLegalMoves(table.ChessBoard, nextTurn))
            {
                gameOver = true; winnerSide = cur.seat;
                winnerUsername = table.Seats[cur.seat]?.Username;
                table.State = "ended";
            }
            else table.CurrentTurn = nextTurn;
        }

        await Clients.Group(TableGroup(cur.tid)).SendAsync("ChessMoveResult", new {
            pieceId, toCol, toRow, capturedId,
            nextTurn       = gameOver ? -1 : table.CurrentTurn,
            checkSide      = checkSideVal,
            winnerSide     = gameOver ? (int?)winnerSide : null,
            winnerUsername,
        });

        if (gameOver) await FinishGame(cur.gt, cur.tid, table.Seats[1-cur.seat]?.ConnectionId);
    }

    // ── 投降 ─────────────────────────────────────────────────────────────────

    public async Task Surrender()
    {
        if (!SeatMap.TryGetValue(Context.ConnectionId, out var cur)) return;
        var table = Tables[cur.gt].FirstOrDefault(t => t.Id == cur.tid);
        if (table == null) return;

        var winnerSide = 1 - cur.seat;
        var winnerName = table.Seats[winnerSide]?.Username ?? "对手";
        lock (Lock) ResetTable(table);

        await Clients.Group(TableGroup(cur.tid)).SendAsync("GameEnded",
            new { winnerSide, winnerUsername = winnerName, reason = "投降" });
        await Clients.Group(LobbyGroup(cur.gt)).SendAsync("TableUpdated", TableDto(table));
    }

    // ── 断线处理 ─────────────────────────────────────────────────────────────

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await HandleStandUp(Context.ConnectionId, notifyOpponent: true);
        await base.OnDisconnectedAsync(exception);
    }

    // ── 内部：结束对局清理 ────────────────────────────────────────────────────

    private async Task FinishGame(string gameType, int tableId, string? oppConnId)
    {
        var table = Tables[gameType].FirstOrDefault(t => t.Id == tableId);
        if (table == null) return;
        lock (Lock)
        {
            ResetTable(table);
            SeatMap.Remove(Context.ConnectionId);
            if (oppConnId != null) SeatMap.Remove(oppConnId);
        }
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, TableGroup(tableId));
        if (oppConnId != null) await Groups.RemoveFromGroupAsync(oppConnId, TableGroup(tableId));
        await Clients.Group(LobbyGroup(gameType)).SendAsync("TableUpdated", TableDto(table));
    }
}
