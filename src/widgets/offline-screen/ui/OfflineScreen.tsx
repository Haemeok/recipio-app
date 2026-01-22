import { StyleSheet, Text, View, TouchableOpacity } from "react-native";
import NetInfo from "@react-native-community/netinfo";

interface OfflineScreenProps {
  onRetry?: () => void;
}

export const OfflineScreen = ({ onRetry }: OfflineScreenProps) => {
  const handleRetry = async () => {
    const state = await NetInfo.fetch();
    if (state.isConnected && state.isInternetReachable) {
      onRetry?.();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📡</Text>
      <Text style={styles.title}>인터넷 연결 없음</Text>
      <Text style={styles.description}>
        네트워크 연결을 확인하고 다시 시도해주세요.
      </Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
        <Text style={styles.retryButtonText}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    padding: 24,
  },
  icon: {
    fontSize: 64,
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: "#666666",
    textAlign: "center",
    marginBottom: 32,
  },
  retryButton: {
    backgroundColor: "#FF6B35",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
