import { HomePolicyService } from './home-policy.service';

describe('HomePolicyService', () => {
  const policy = new HomePolicyService();

  it('rejects joining when already in a Home', () => {
    expect(() => policy.assertCanJoin('home-a', 1)).toThrow('ALREADY_IN_HOME');
  });

  it('rejects joining a full Home', () => {
    expect(() => policy.assertCanJoin(null, 4)).toThrow('HOME_FULL');
    expect(() => policy.assertCanJoin(null, 3)).not.toThrow();
  });

  it('requires membership to leave', () => {
    expect(() => policy.assertCanLeave(null)).toThrow('NOT_HOME_MEMBER');
    expect(() => policy.assertCanLeave('home-a')).not.toThrow();
  });

  it('lets only the owner remove a same-Home participant', () => {
    expect(() =>
      policy.assertCanRemove({
        requesterId: 'owner-1',
        requesterRole: 'OWNER',
        requesterHomeId: 'home-a',
        targetHomeId: 'home-a',
        targetUserId: 'user-2',
      }),
    ).not.toThrow();

    expect(() =>
      policy.assertCanRemove({
        requesterId: 'user-2',
        requesterRole: 'PARTICIPANT',
        requesterHomeId: 'home-a',
        targetHomeId: 'home-a',
        targetUserId: 'user-3',
      }),
    ).toThrow('NOT_HOME_OWNER');

    expect(() =>
      policy.assertCanRemove({
        requesterId: 'owner-1',
        requesterRole: 'OWNER',
        requesterHomeId: 'home-a',
        targetHomeId: 'home-b',
        targetUserId: 'user-9',
      }),
    ).toThrow('NOT_HOME_MEMBER');

    expect(() =>
      policy.assertCanRemove({
        requesterId: 'owner-1',
        requesterRole: 'OWNER',
        requesterHomeId: 'home-a',
        targetHomeId: 'home-a',
        targetUserId: 'owner-1',
      }),
    ).toThrow('CANNOT_REMOVE_SELF');
  });

  it('blocks invites across two occupied Homes without reserving capacity', () => {
    expect(() =>
      policy.assertCanInvite({ inviterHomeId: null, inviteeHomeId: null }),
    ).toThrow('NOT_HOME_MEMBER');

    expect(() =>
      policy.assertCanInvite({ inviterHomeId: 'home-a', inviteeHomeId: 'home-a' }),
    ).toThrow('ALREADY_IN_HOME');

    expect(() =>
      policy.assertCanInvite({ inviterHomeId: 'home-a', inviteeHomeId: 'home-b' }),
    ).toThrow('USER_ALREADY_IN_ANOTHER_HOME');

    expect(() =>
      policy.assertCanInvite({ inviterHomeId: 'home-a', inviteeHomeId: null }),
    ).not.toThrow();
  });

  it('checks one-Home rule and capacity at accept time', () => {
    expect(() => policy.assertCanAccept('home-a', 1)).toThrow('ALREADY_IN_HOME');
    expect(() => policy.assertCanAccept(null, 4)).toThrow('HOME_FULL');
    expect(() => policy.assertCanAccept(null, 3)).not.toThrow();
  });

  it('routes join requests through a homed target member', () => {
    expect(() =>
      policy.assertCanRequestJoin({
        requesterHomeId: 'home-a',
        targetHomeId: 'home-b',
      }),
    ).toThrow('ALREADY_IN_HOME');
    expect(() =>
      policy.assertCanRequestJoin({
        requesterHomeId: null,
        targetHomeId: null,
      }),
    ).toThrow('TARGET_HAS_NO_HOME');
    expect(() =>
      policy.assertCanRequestJoin({
        requesterHomeId: null,
        targetHomeId: 'home-b',
      }),
    ).not.toThrow();
  });
});
