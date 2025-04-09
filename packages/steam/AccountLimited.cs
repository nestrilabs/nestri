using SteamKit2;
using SteamKit2.Internal;

namespace SteamAuth.SteamDataClient;

class AccountLimitation : ClientMsgHandler
{
    public class IsLimitedAccountCallback : CallbackMsg
    {
        public bool Limited { get; private set; }
        public bool CommunityBanned { get; private set; }
        public bool Locked { get; private set; }
        public bool AllowedToInviteFriends { get; private set; }

        internal IsLimitedAccountCallback(bool limited, bool communityBanned, bool locked, bool allowedToInviteFriends)
        {
            Limited = limited;
            CommunityBanned = communityBanned;
            Locked = locked;
            AllowedToInviteFriends = allowedToInviteFriends;
        }
    }

    void HandleClientIsLimitedAccount(IPacketMsg packetMsg)
    {
        var isLimitedAccountMsg = new ClientMsgProtobuf<CMsgClientIsLimitedAccount>(packetMsg);

        Console.WriteLine($"Getting account isLimited stuff...");
        
        var limited = isLimitedAccountMsg.Body.bis_limited_account;
        var communityBanned = isLimitedAccountMsg.Body.bis_community_banned;
        var locked = isLimitedAccountMsg.Body.bis_locked_account;
        var allowedToInviteFriends = isLimitedAccountMsg.Body.bis_limited_account_allowed_to_invite_friends;

        var isLimitedAccountCallback = new IsLimitedAccountCallback(limited, communityBanned, locked, allowedToInviteFriends);
        Client.PostCallback(isLimitedAccountCallback);
    }

    public override void HandleMsg(IPacketMsg packetMsg)
    {
        if (packetMsg.MsgType == EMsg.ClientIsLimitedAccount)
            HandleClientIsLimitedAccount(packetMsg);
    }
}