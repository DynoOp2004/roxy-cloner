require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const https = require('https');

const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

const log = {
    success: msg => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
    error: msg => console.log(`${colors.red}[-] ${msg}${colors.reset}`),
    warning: msg => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
    info: msg => console.log(`${colors.cyan}[i] ${msg}${colors.reset}`)
};

const delay = ms => new Promise(r => setTimeout(r, ms));

async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            const data = [];
            res.on('data', d => data.push(d));
            res.on('end', () => {
                const buffer = Buffer.concat(data);
                resolve(`data:${res.headers['content-type']};base64,${buffer.toString('base64')}`);
            });
        }).on('error', reject);
    });
}

class ServerCloner {
    constructor(client) {
        this.client = client;
        this.roleMapping = new Map();
        this.stats = { roles: 0, categories: 0, channels: 0, emojis: 0, failed: 0 };
    }

    async cloneServer(sourceId, targetId, cloneEmojis, progressChannel) {
        const source = this.client.guilds.cache.get(sourceId);
        const target = this.client.guilds.cache.get(targetId);

        if (!source || !target) throw new Error('Guild not found');

        this.send('🗑️ Cleaning target server...', progressChannel);
        await this.cleanup(target);

        await this.cloneRoles(source, target, progressChannel);
        await this.cloneCategories(source, target, progressChannel);
        await this.cloneChannels(source, target, progressChannel);
        if (cloneEmojis) await this.cloneEmojis(source, target, progressChannel);
        await this.cloneInfo(source, target, progressChannel);

        this.send('🎉 Cloning completed successfully!', progressChannel);
    }

    async cleanup(guild) {
        for (const c of guild.channels.cache.values()) if (c.deletable) await c.delete().catch(() => {});
        for (const r of guild.roles.cache.values())
            if (r.name !== '@everyone' && r.editable) await r.delete().catch(() => {});
    }

    // ✅ FIXED ROLE CLONING
    async cloneRoles(source, target, progressChannel) {
        this.send('👑 Cloning roles...', progressChannel);

        const sourceRoles = source.roles.cache
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => a.position - b.position); // bottom → top

        const created = [];

        for (const role of sourceRoles.values()) {
            try {
                const newRole = await target.roles.create({
                    name: role.name,
                    color: role.hexColor,
                    permissions: role.permissions,
                    hoist: role.hoist,
                    mentionable: role.mentionable,
                    reason: 'Server clone'
                });

                this.roleMapping.set(role.id, newRole.id);
                created.push(newRole);
                this.stats.roles++;

                this.send(`Created role: ${role.name}`, progressChannel);
                await delay(200);
            } catch {
                this.stats.failed++;
            }
        }

        // ✅ ONE SAFE POSITION FIX
        await target.roles.setPositions(
            created.map((r, i) => ({ id: r.id, position: i + 1 }))
        ).catch(() => {});

        this.send('✅ Role order fixed correctly', progressChannel);
    }

    async cloneCategories(source, target, progressChannel) {
        for (const cat of source.channels.cache
            .filter(c => c.type === 'GUILD_CATEGORY')
            .sort((a, b) => a.position - b.position)
            .values()) {
            await target.channels.create(cat.name, {
                type: 'GUILD_CATEGORY',
                position: cat.position
            }).catch(() => {});
            this.stats.categories++;
        }
    }

    async cloneChannels(source, target, progressChannel) {
        for (const ch of source.channels.cache
            .filter(c => c.type === 'GUILD_TEXT' || c.type === 'GUILD_VOICE')
            .sort((a, b) => a.position - b.position)
            .values()) {

            const parent = ch.parent
                ? target.channels.cache.find(c => c.name === ch.parent.name)
                : null;

            await target.channels.create(ch.name, {
                type: ch.type,
                parent: parent?.id,
                topic: ch.topic,
                nsfw: ch.nsfw,
                bitrate: ch.bitrate,
                userLimit: ch.userLimit
            }).catch(() => {});

            this.stats.channels++;
        }
    }

    async cloneEmojis(source, target, progressChannel) {
        for (const emoji of source.emojis.cache.values()) {
            try {
                const img = await downloadImage(emoji.url);
                await target.emojis.create(img, emoji.name);
                this.stats.emojis++;
                await delay(2000);
            } catch {
                this.stats.failed++;
            }
        }
    }

    async cloneInfo(source, target) {
        if (source.iconURL()) {
            const icon = await downloadImage(source.iconURL({ size: 1024 }));
            await target.setIcon(icon).catch(() => {});
        }
        await target.setName(source.name).catch(() => {});
    }

    send(msg, ch) {
        if (ch) ch.send(msg).catch(() => {});
        log.info(msg.replace(/[^\w\s]/g, ''));
    }
}

const client = new Client();
const pending = new Map();

client.on('messageCreate', async msg => {
    if (!msg.content.startsWith('!clone')) return;

    const [ , sourceId, targetId ] = msg.content.split(' ');
    if (!sourceId || !targetId) return;

    msg.channel.send('Proceed? (y/n)');
    pending.set(msg.author.id, { sourceId, targetId });

    client.once('messageCreate', async reply => {
        if (reply.author.id !== msg.author.id) return;
        if (!['y','yes'].includes(reply.content.toLowerCase())) return;

        msg.channel.send('Clone emojis? (y/n)');
        client.once('messageCreate', async r2 => {
            const cloner = new ServerCloner(client);
            await cloner.cloneServer(
                sourceId,
                targetId,
                ['y','yes'].includes(r2.content.toLowerCase()),
                msg.channel
            );
        });
    });
});

client.login(process.env.TOKEN);
