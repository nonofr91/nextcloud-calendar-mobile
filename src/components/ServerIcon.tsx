import React from 'react';
import { Image, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useServerIcon } from '@/features/account/hooks/useServerIcon';
import { accountTagColor, accountTagLabel } from '@/features/account/utils/account';
import type { Account } from '@/types';

interface Props {
  account: Account;
  size: number;
}

/**
 * The account's server logo (theming image). Falls back to a deterministic
 * account-colored rounded square while loading or when theming has no logo.
 */
export function ServerIcon({ account, size }: Props) {
  const { data } = useServerIcon(account);
  const style = { width: size, height: size, borderRadius: size * 0.25 };
  const label = accountTagLabel(account);

  if (data?.kind === 'svg') {
    return (
      <View style={style} accessibilityRole="image" accessibilityLabel={label}>
        <SvgXml xml={data.svg} width={size} height={size} />
      </View>
    );
  }
  if (data?.kind === 'uri') {
    return (
      <Image
        source={{ uri: data.uri }}
        style={style}
        accessibilityLabel={label}
      />
    );
  }
  return (
    <View
      style={[style, { backgroundColor: accountTagColor(account.id) }]}
      accessibilityRole="image"
      accessibilityLabel={label}
    />
  );
}
