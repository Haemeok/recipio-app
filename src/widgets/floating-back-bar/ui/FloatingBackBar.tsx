import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface FloatingBackBarProps {
  onPress: () => void;
}

// Android에서 외부 OAuth 페이지(예: 카카오 로그인) 위에 띄우는 뒤로가기 바.
// iOS는 swipe-back gesture가 있어 불필요.
export const FloatingBackBar = ({ onPress }: FloatingBackBarProps) => {
  return (
    <View style={styles.bar}>
      <TouchableOpacity onPress={onPress} style={styles.button}>
        <Text style={styles.text}>← 돌아가기</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
});
