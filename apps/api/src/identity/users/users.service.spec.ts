import * as argon2 from 'argon2';
import { UsersService } from './users.service';
import type { UsersRepository } from './users.repository';

function buildService() {
  const updatePasswordHash = jest.fn().mockResolvedValue(undefined);
  const repository = {
    updatePasswordHash,
  } as unknown as UsersRepository;
  const service = new UsersService(repository);
  return { service, updatePasswordHash };
}

describe('UsersService.hashPassword / updatePasswordHash', () => {
  it('hashPassword produces a verifiable argon2 hash, distinct from the plaintext', async () => {
    const { service } = buildService();

    const hash = await service.hashPassword('newpassword123');

    expect(hash).not.toBe('newpassword123');
    expect(await argon2.verify(hash, 'newpassword123')).toBe(true);
    expect(await argon2.verify(hash, 'wrongpassword')).toBe(false);
  });

  it('updatePasswordHash forwards the id and hash to the repository unchanged', async () => {
    const { service, updatePasswordHash } = buildService();

    await service.updatePasswordHash('user-1', 'precomputed-hash');

    expect(updatePasswordHash).toHaveBeenCalledWith(
      'user-1',
      'precomputed-hash',
    );
  });
});
