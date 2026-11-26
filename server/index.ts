import { DEFAULT_GAME_PORT } from '../shared/protocol.js';
import { buildServer } from './http.js';

const { http } = buildServer();
const port = Number(process.env.PORT ?? DEFAULT_GAME_PORT);
http.listen(port, '0.0.0.0', () => console.log(`干瞪眼联机服务已启动：http://localhost:${port}`));
