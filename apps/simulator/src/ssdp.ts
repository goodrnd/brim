/**
 * Announces the simulator the way a Bambu printer does: an SSDP NOTIFY on UDP 2021 every second, so
 * bambu-printer-mcp's counterpart_discover_printers finds it. The MCP only accepts an announcement from a private
 * IPv4 address that names itself as `Location`, so it goes out from each LAN interface, never loopback.
 */
import {createSocket} from 'node:dgram';
import {networkInterfaces} from 'node:os';

/** DevModel ids the MCP maps to a model (safety/printer-state.ts MODEL_IDS). */
const devModels = {p1s: 'C12', x2d: 'N6'} as const;

const privateIPv4 = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** This machine's private IPv4 addresses with their subnet broadcast address. */
export function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && !n.internal && n.family === 'IPv4' && privateIPv4(n.address))
    .map((n) => {
      const ip = n!.address.split('.').map(Number);
      const mask = n!.netmask.split('.').map(Number);
      return {address: n!.address, broadcast: ip.map((b, i) => b | (~mask[i] & 255)).join('.')};
    });
}

export function notify(address: string, serial: string, model: keyof typeof devModels, name: string) {
  return [
    'NOTIFY * HTTP/1.1',
    'HOST: 239.255.255.250:1990',
    'Server: UPnP/1.0',
    `Location: ${address}`,
    'NT: urn:bambulab-com:device:3dprinter:1',
    'NTS: ssdp:alive',
    `USN: ${serial}`,
    'Cache-Control: max-age=1800',
    `DevModel.bambu.com: ${devModels[model]}`,
    `DevName.bambu.com: ${name}`,
    'DevConnect.bambu.com: lan',
    'DevBind.bambu.com: free',
    'DevVersion.bambu.com: 01.00.00.00',
    '',
    '',
  ].join('\r\n');
}

/**
 * Starts announcing; returns a stop function.
 * Broadcast, not multicast: macOS refuses multicast sends from an unprivileged process (EHOSTUNREACH).
 */
export function announce(serial: string, model: keyof typeof devModels, name: string, port = 2021) {
  const sockets = lanAddresses().map(({address, broadcast}) => {
    const socket = createSocket('udp4');
    socket.on('error', () => {});
    socket.bind(0, address, () => socket.setBroadcast(true));
    return {socket, send: () => socket.send(notify(address, serial, model, name), port, broadcast)};
  });
  const timer = setInterval(() => sockets.forEach((s) => s.send()), 1000);
  return () => {
    clearInterval(timer);
    sockets.forEach((s) => s.socket.close());
  };
}
