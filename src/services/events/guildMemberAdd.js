const Discord=require('discord.js');

module.exports = async (BOT,member) => {
    let config = BOT.Configs.get(member.guild.id); if(!config){ return; }
    const customer = new StripeClient({
        user_id: member.id,
        guild_id: member.guild.id,
    });
    const record = await customer.fetchRecordByUser();
    const guild = customer.indentifyGuild();
    const user = new DiscordClient(record);
    user.assignRole(guild.defRole);
    
}
