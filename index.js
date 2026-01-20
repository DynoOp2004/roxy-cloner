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

const delay = ms => new Promise(res => setTimeout(res, ms));

async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve(`data:${res.headers['content-type']};base64,${buffer.toString('base64')}`);
            });
        }).on('error', reject);
    });
}

class ServerCloner {
    constructor(client) {
        this.client = client;
        this.roleMapping = new Map();
        this.stats = {
            rolesCreated: 0,
            categoriesCreated: 0,
            channelsCreated: 0,
            emojisCreated: 0,
            failed: 0
        };
    }

    async cloneServer(sourceId, targetId, cloneEmojis, progressChannel) {
        const source = this.client.guilds.cache.get(sourceId);
        const target = this.client.guilds.cache.get(targetId);

        if (!source) throw new Error('Source server not found');
        if (!target) throw new Error('Target server not found');

        await this.deleteExistingContent(target, progressChannel);
        await this.cloneRoles(source, target, progressChannel);
        await this.cloneCategories(source, target, progressChannel);
        await this.cloneChannels(source, target, progressChannel);
        if (cloneEmojis) await this.cloneEmojis(source, target, progressChannel);
        await this.cloneServerInfo(source, target, progressChannel);

        this.sendProgress('🎉 Server cloning completed!', progressChannel);
    }

    async deleteExistingContent(guild, progressChannel) {
        for (const c of guild.channels.cache.values()) {
            if (c.deletable) await c.delete().catch(() => {});
        }
        for (const r of guild.roles.cache.values()) {
            if (r.name !== '@everyone' && r.editable) await r.delete().catch(() => {});
        }
    }

    // ✅ FIXED ROLE CLONING
    async cloneRoles(sourceGuild, targetGuild, progressChannel) {
        this.sendProgress('👑 Cloning roles...', progressChannel);

        const sourceRoles = sourceGuild.roles.cache
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => a.position - b.position); // bottom → top

        const createdRoles = [];

        for (const [, role] of sourceRoles) {
            try {
                const newRole = await targetGuild.roles.create({
                    name: role.name,
                    color: role.hexColor,
                    permissions: role.permissions,
                    hoist: role.hoist,
                    mentionable: role.mentionable,
                    reason: 'Server cloning'
                });

                this.roleMapping.set(role.id, newRole.id);
                createdRoles.push(newRole);
                this.stats.rolesCreated++;

                this.sendProgress(`Created role: ${role.name}`, progressChannel);
                await delay(200);
            } catch {
                this.stats.failed++;
            }
        }

        // ✅ ONE ATOMIC POSITION FIX (THIS IS THE KEY)
        await targetGuild.roles.setPositions(
            createdRoles.map((r, i) => ({
                id: r.id,
                position: i + 1
            }))
        ).catch(() => {});

        this.sendProgress('✅ Role order fixed correctly', progressChannel);
    }

    async cloneCategories(source, target) {
        for (const c of source.channels.cache
            .filter(ch => ch.type === 'GUILD_CATEGORY')
            .sort((a, b) => a.position - b.position)
            .values()) {
            await target.channels.create(c.name, { type: 'GUILD_CATEGORY' }).catch(() => {});
            this.stats.categoriesCreated++;
        }
    }

    async cloneChannels(source, target) {
        for (const c of source.channels.cache
            .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 'GUILD_VOICE')
            .sort((a, b) => a.position - b.position)
            .values()) {
            await target.channels.create(c.name, {
                type: c.type,
                parent: c.parent ? target.channels.cache.find(x => x.name === c.parent.name)?.id : null,
                topic: c.topic,
                nsfw: c.nsfw,
                bitrate: c.bitrate,
                userLimit: c.userLimit
            }).catch(() => {});
            this.stats.channelsCreated++;
        }
    }

    async cloneEmojis(source, target) {
        for (const e of source.emojis.cache.values()) {
            try {
                const img = await downloadImage(e.url);
                await target.emojis.create(img, e.name);
                this.stats.emojisCreated++;
                await delay(2000);
            } catch {
                this.stats.failed++;
            }
        }
    }

    async cloneServerInfo(source, target) {
        if (source.iconURL()) {
            const icon = await downloadImage(source.iconURL({ size: 1024 }));
            await target.setIcon(icon).catch(() => {});
        }
        await target.setName(source.name).catch(() => {});
    }

    sendProgress(msg, ch) {
        if (ch) ch.send(msg).catch(() => {});
        log.info(msg.replace(/[^\w\s]/g, ''));
    }
}

const client = new Client();

client.on('messageCreate', async msg => {
    if (!msg.content.startsWith('!clone')) return;

    const [, sourceId, targetId] = msg.content.split(' ');
    if (!sourceId || !targetId) return;

    msg.channel.send('Proceed? (y/n)');
    client.once('messageCreate', async r1 => {
        if (r1.author.id !== msg.author.id) return;
        if (!['y', 'yes'].includes(r1.content.toLowerCase())) return;

        msg.channel.send('Clone emojis? (y/n)');
        client.once('messageCreate', async r2 => {
            const cloner = new ServerCloner(client);
            await cloner.cloneServer(
                sourceId,
                targetId,
                ['y', 'yes'].includes(r2.content.toLowerCase()),
                msg.channel
            );
        });
    });
});

client.login(process.env.TOKEN);
