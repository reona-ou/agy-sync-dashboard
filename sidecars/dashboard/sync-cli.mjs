import { SyncManager } from './sync.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sync-dir' && argv[i + 1]) {
      out.syncDir = argv[++i];
    } else if (a === '--device-name' && argv[i + 1]) {
      out.deviceName = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const manager = new SyncManager();

const result =
  args.syncDir || args.deviceName
    ? (await manager.updateSettings(args)).synced
    : await manager.syncOnce();

const summary = {
  deviceId: result.device.deviceId,
  deviceName: result.device.deviceName,
  syncStatus: result.syncStatus,
  mergedTotals: result.merged.totals,
  deviceCount: result.merged.deviceCount,
  devices: result.merged.devices.map((d) => ({
    deviceId: d.deviceId,
    deviceName: d.deviceName,
    totalTokens: d.totals.totalTokens,
    todayTokens: d.todayTokens,
    isCurrent: d.isCurrent,
  })),
};

console.log(JSON.stringify(summary, null, 2));
