export async function applyLeaveConversation(conversation, ctx) {
    await ctx.reply("Please enter the date of requested leave in DD-MM-YYYY format\n\n"
            + "Enter `exit` to terminate this transaction");

    while (true) {
        var dateCtx = await conversation.waitFor("message:text");
        var date = dateCtx.message.text;

        console.log("Date Entered: ", date);

        if (date == "exit") {
            ctx.reply("Terminated");
            return;
        }

        if (dateRegex.test(date) && isSaturday(date)) {
            break;
        }
        await ctx.reply("Invalid date entered. Please try again.");
    }

    await ctx.reply("Please state the reason for your absence\n\nEnter `exit` to terminate this transaction");
    var reasonCtx = await conversation.waitFor("message:text");
    var reason = reasonCtx.message.text;

    console.log("Reason Entered: ", reason);

    if (reason == "exit") {
        ctx.reply("Terminated");
        return;
    }

    const id = ctx.from.id;

    try {
        // Retrieve Applicant Name
        const member = await getMemberById(id);
        const name = member.name;

        // Apply Leave in Database
        await applyLeave(id, name, date, reason);
        await ctx.reply("Your leave application has been sent for approval");
        const newLeave = await getLeaveByUserIdAndDate(id, date);

        // Notify Committee
        const keyboard = new InlineKeyboard()
                .text("Approve", `approve:${newLeave.id}`)
                .text("Reject", `reject:${newLeave.id}`);
        await bot.api.sendMessage(fortitudeCommChatId,
                `<b>New Leave Application</b>\n`
                + `Name: ${name}\n`
                + `Date: ${date}\n`
                + `Reason: ${reason}`,
                { message_thread_id: fortitudeCommAttendanceMessageThreadId,
                        parse_mode: 'HTML',
                        reply_markup: keyboard}
        );
    } catch (err) {
        await ctx.reply(err.message);
    }
}
