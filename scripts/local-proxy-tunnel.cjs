// Windows half of the WSL trial's private stdio relay. No listening socket,
// arbitrary destination or external protocol is accepted by this helper.
const net = require('node:net')
const socket = net.connect({ host: '127.0.0.1', port: 7890 })
socket.on('error', () => { process.exitCode = 1; process.stdin.destroy() })
process.stdin.on('error', () => socket.destroy())
process.stdout.on('error', () => socket.destroy())
process.stdin.pipe(socket)
socket.pipe(process.stdout)
socket.on('close', () => process.stdin.destroy())
