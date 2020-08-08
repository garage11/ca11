export default function(_) {
    return {
        new: async function(actor) {
            const {page} = actor

            await _.step(actor, 'new session')
            await page.waitFor('.t-login')
            await _.screenshot(actor, 'new-session', {only: 'alice'})
            await page.type('.t-txt-sig11-number', actor.sig11.number)
            await page.type('.t-txt-session-pw', actor.session.password)
            await _.screenshot(actor, 'new-session-filled', {only: 'alice'})
            await page.click('.t-btn-login')
            await page.waitFor('.t-wizard')
        },
    }
}
