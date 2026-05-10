import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import tasksRouter from "./tasks";
import wheelRouter from "./wheel";
import withdrawalsRouter from "./withdrawals";
import adminRouter from "./admin";
import stickerRouter from "./sticker";
import verifyRouter from "./verify";
import botRouter from "./bot";
import leaderboardRouter from "./leaderboard";
import manifestRouter from "./manifest";
import subscriptionRouter from "./subscription";
import sessionRouter from "./session";
import priceRouter from "./price";
import avatarRouter from "./avatar";

const router: IRouter = Router();

router.use(healthRouter);
router.use(manifestRouter);
router.use("/session", sessionRouter);
router.use("/users", usersRouter);
router.use("/tasks", tasksRouter);
router.use("/wheel", wheelRouter);
router.use("/withdrawals", withdrawalsRouter);
router.use("/admin", adminRouter);
router.use("/sticker", stickerRouter);
router.use(verifyRouter);
router.use(botRouter);
router.use(leaderboardRouter);
router.use("/subscription", subscriptionRouter);
router.use(priceRouter);
router.use(avatarRouter);

export default router;
